// stripe-webhook — Stripe's callback into our system. The authoritative
// reconciler: even if stripe-charge-booking's HTTP response is lost, Stripe
// resends these events until we 2xx, so the payments/visits/clients rows always
// converge on what actually happened at Stripe.
//
// AUTH: there is NO Supabase JWT here — Stripe can't produce one. Authenticity
// is the HMAC signature over the raw body (verifyStripeSignature). This
// function MUST be deployed with verify_jwt = false; the signature IS the auth.
//
// Handled events (configure exactly these in the Stripe dashboard):
//   checkout.session.completed   → a card was saved → set client.card_on_file
//   payment_intent.succeeded     → a booking charge cleared → visit 'paid'
//   payment_intent.payment_failed→ a charge declined → visit stays 'unpaid'
//   charge.refunded              → money returned → payment + visit 'refunded'
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.

import { createClient } from "npm:@supabase/supabase-js@2";
import { retrieveSetupIntent, setCustomerDefaultPaymentMethod, verifyStripeSignature } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const now = () => new Date().toISOString();

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json(500, { error: "STRIPE_WEBHOOK_SECRET not set" });

  // Verify against the RAW body — any re-serialization would break the HMAC.
  const raw = await req.text();
  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = await verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret);
  } catch (e) {
    // 400 = do not retry; the signature is wrong, resending won't help.
    return json(400, { error: `signature: ${(e as Error).message}` });
  }

  try {
    const obj = event.data?.object ?? {};
    switch (event.type) {
      case "checkout.session.completed": {
        if (obj.mode !== "setup") break; // only the card-save flow concerns us
        const customerId: string | undefined = obj.customer;
        const setupIntentId: string | undefined = obj.setup_intent;
        if (!customerId || !setupIntentId) break;
        const si = await retrieveSetupIntent(setupIntentId);
        const pmId: string | undefined = si.payment_method;
        if (!pmId) break;
        // Make it the customer's default so off-session charges pick it up.
        await setCustomerDefaultPaymentMethod(customerId, pmId);
        const { error } = await service
          .from("clients")
          .update({ default_payment_method_id: pmId, card_on_file: true, updated_at: now() })
          .eq("stripe_customer_id", customerId);
        if (error) throw new Error(`clients update: ${error.message}`);
        break;
      }

      case "payment_intent.succeeded": {
        const piId: string = obj.id;
        const chargeId: string | null = obj.latest_charge ?? null;
        const visitId: string | undefined = obj.metadata?.visit_id;
        const clientId: string | undefined = obj.metadata?.client_id;
        const { data: payment, error: payErr } = await service
          .from("payments")
          .upsert(
            {
              client_id: clientId,
              visit_id: visitId ?? null,
              amount_cents: obj.amount_received ?? obj.amount ?? 0,
              currency: obj.currency ?? "usd",
              status: "succeeded",
              stripe_payment_intent_id: piId,
              stripe_charge_id: chargeId,
              updated_at: now(),
            },
            { onConflict: "stripe_payment_intent_id" },
          )
          .select("id")
          .single();
        if (payErr) throw new Error(`payments upsert: ${payErr.message}`);
        if (visitId) {
          const { error } = await service
            .from("visits")
            .update({ payment_status: "paid", payment_id: payment.id })
            .eq("id", visitId);
          if (error) throw new Error(`visit paid: ${error.message}`);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const piId: string = obj.id;
        const visitId: string | undefined = obj.metadata?.visit_id;
        const clientId: string | undefined = obj.metadata?.client_id;
        const reason: string = obj.last_payment_error?.message ?? "payment failed";
        const { error: payErr } = await service.from("payments").upsert(
          {
            client_id: clientId,
            visit_id: visitId ?? null,
            amount_cents: obj.amount ?? 0,
            currency: obj.currency ?? "usd",
            status: "failed",
            stripe_payment_intent_id: piId,
            error_message: reason,
            updated_at: now(),
          },
          { onConflict: "stripe_payment_intent_id" },
        );
        if (payErr) throw new Error(`payments upsert: ${payErr.message}`);
        // Only (re)mark unpaid if not already resolved another way.
        if (visitId) {
          await service
            .from("visits")
            .update({ payment_status: "unpaid" })
            .eq("id", visitId)
            .in("payment_status", ["not_required", "unpaid"]);
        }
        break;
      }

      case "charge.refunded": {
        const piId: string | undefined = obj.payment_intent;
        if (!piId) break;
        const { data: payment, error: findErr } = await service
          .from("payments")
          .update({ status: "refunded", updated_at: now() })
          .eq("stripe_payment_intent_id", piId)
          .select("visit_id")
          .maybeSingle();
        if (findErr) throw new Error(`payments refund: ${findErr.message}`);
        if (payment?.visit_id) {
          await service.from("visits").update({ payment_status: "refunded" }).eq("id", payment.visit_id);
        }
        break;
      }

      default:
        // Unhandled but valid — 200 so Stripe stops resending.
        break;
    }
  } catch (e) {
    // 500 = a transient DB problem; let Stripe retry the delivery later.
    return json(500, { error: `handling ${event.type}: ${(e as Error).message}` });
  }

  return json(200, { received: true, type: event.type });
});
