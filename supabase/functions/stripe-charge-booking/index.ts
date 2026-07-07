// stripe-charge-booking — charge a client's saved card for a booked visit.
// The heart of the pre-payment gate (issue #40): auto-charge the card on file,
// off-session, at booking time.
//
// POST { visit_id } with an ADMIN JWT (verify_jwt ON).
// Preconditions: the visit has a price; the client has a card on file.
// Result:
//   * success  → payments row 'succeeded', visit.payment_status 'paid'.
//   * declined → payments row 'failed' (with the reason), visit stays 'unpaid';
//                responds 402 so the caller can offer retry or admin override.
//
// The stripe-webhook function is the backstop source of truth — it reconciles
// the same payments/visit rows from Stripe's own event, so a dropped response
// here never leaves us out of sync.
//
// Secrets: STRIPE_SECRET_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";
import { chargeOffSession, type StripeError } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let visitId: string;
  try {
    const body = await req.json();
    visitId = String(body.visit_id ?? "");
  } catch {
    return json(400, { error: "JSON body { visit_id } required" });
  }
  if (!/^[0-9a-f-]{36}$/i.test(visitId)) return json(400, { error: "visit_id must be a UUID" });

  const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
  });
  const { data: isAdmin, error: adminErr } = await caller.rpc("app_is_admin");
  if (adminErr) return json(500, { error: `admin check: ${adminErr.message}` });
  if (isAdmin !== true) return json(403, { error: "admins only" });

  // Load the visit + its price. Prefer the price copied onto the visit; fall
  // back to the linked service's catalog price and copy it down.
  const { data: visit, error: visitErr } = await service
    .from("visits")
    .select("id, client_id, price_cents, payment_status, service_id, services(price_cents)")
    .eq("id", visitId)
    .maybeSingle();
  if (visitErr) return json(500, { error: `visit lookup: ${visitErr.message}` });
  if (!visit) return json(404, { error: "visit not found" });
  if (!visit.client_id) return json(422, { error: "visit has no client to charge" });
  if (visit.payment_status === "paid") {
    return json(200, { already_paid: true, visit_id: visitId });
  }

  const servicePrice = (visit.services as unknown as { price_cents: number } | null)?.price_cents;
  const amountCents = visit.price_cents ?? servicePrice ?? null;
  if (amountCents === null || amountCents <= 0) {
    return json(422, { error: "visit has no price (set a service/price before charging)" });
  }

  const { data: client, error: clientErr } = await service
    .from("clients")
    .select("id, stripe_customer_id, default_payment_method_id, card_on_file")
    .eq("id", visit.client_id)
    .maybeSingle();
  if (clientErr) return json(500, { error: `client lookup: ${clientErr.message}` });
  if (!client) return json(404, { error: "client not found" });
  if (!client.card_on_file || !client.stripe_customer_id || !client.default_payment_method_id) {
    return json(409, { error: "no card on file — save a card before booking", code: "no_card_on_file" });
  }

  try {
    const intent = await chargeOffSession({
      customerId: client.stripe_customer_id,
      paymentMethodId: client.default_payment_method_id,
      amountCents,
      currency: "usd",
      visitId: visit.id,
      clientId: client.id,
      description: `Dog walk visit ${visit.id}`,
      // Amount is in the key so a legitimate re-charge at a different price is
      // not silently deduped, but a double-tap at the same price is safe.
      idempotencyKey: `visit-charge-${visit.id}-${amountCents}`,
    });

    const succeeded = intent.status === "succeeded";
    const { data: payment, error: payErr } = await service
      .from("payments")
      .upsert(
        {
          client_id: client.id,
          visit_id: visit.id,
          amount_cents: amountCents,
          currency: "usd",
          status: succeeded ? "succeeded" : "processing",
          stripe_payment_intent_id: intent.id,
          stripe_charge_id: intent.latest_charge ?? null,
          description: `Dog walk visit ${visit.id}`,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_payment_intent_id" },
      )
      .select("id")
      .single();
    if (payErr) return json(500, { error: `recording payment: ${payErr.message}` });

    await service
      .from("visits")
      .update({
        price_cents: amountCents,
        payment_id: payment.id,
        payment_status: succeeded ? "paid" : "unpaid",
      })
      .eq("id", visit.id);

    return json(succeeded ? 200 : 202, {
      paid: succeeded,
      status: intent.status,
      payment_intent: intent.id,
      amount_cents: amountCents,
    });
  } catch (e) {
    const err = e as StripeError;
    // Record the failed attempt so the ledger and the webhook agree.
    await service.from("payments").insert({
      client_id: client.id,
      visit_id: visit.id,
      amount_cents: amountCents,
      currency: "usd",
      status: "failed",
      description: `Dog walk visit ${visit.id}`,
      error_message: err.declineCode ? `${err.message} (${err.declineCode})` : err.message,
    });
    await service.from("visits").update({ payment_status: "unpaid" }).eq("id", visit.id);
    return json(402, {
      paid: false,
      error: err.message,
      decline_code: err.declineCode ?? null,
      code: "card_declined",
    });
  }
});
