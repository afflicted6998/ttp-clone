// stripe-save-card — start the hosted "save a card on file" flow for a client.
// Phase 4/5 (issue #40): a client saves a card ONCE; bookings then auto-charge
// it. No card fields ever load in our app — this returns a Stripe-hosted
// Checkout URL (setup mode); the card is entered on Stripe's page and attached
// to the customer by the stripe-webhook function.
//
// POST { client_id } with an ADMIN JWT (verify_jwt ON). Returns { url } to open
// (admin does it during onboarding, or hands the link to the client).
//
// Secrets: STRIPE_SECRET_KEY, PWA_BASE_URL (redirect target).

import { createClient } from "npm:@supabase/supabase-js@2";
import { createCustomer, createSetupCheckoutSession } from "../_shared/stripe.ts";

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

  let clientId: string;
  try {
    const body = await req.json();
    clientId = String(body.client_id ?? "");
  } catch {
    return json(400, { error: "JSON body { client_id } required" });
  }
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return json(400, { error: "client_id must be a UUID" });

  // Admin-only. app_is_admin() runs as the caller (verify_jwt already ensured a
  // valid JWT); a walker or client JWT gets 403.
  const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
  });
  const { data: isAdmin, error: adminErr } = await caller.rpc("app_is_admin");
  if (adminErr) return json(500, { error: `admin check: ${adminErr.message}` });
  if (isAdmin !== true) return json(403, { error: "admins only" });

  const { data: client, error: clientErr } = await service
    .from("clients")
    .select("id, full_name, email, stripe_customer_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) return json(500, { error: `client lookup: ${clientErr.message}` });
  if (!client) return json(404, { error: "client not found" });

  try {
    // Create the Stripe customer on first card-save; reuse it thereafter.
    let customerId = client.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await createCustomer({
        email: client.email,
        name: client.full_name,
        clientId: client.id,
      });
      customerId = customer.id;
      const { error: upErr } = await service
        .from("clients")
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq("id", client.id);
      if (upErr) return json(500, { error: `saving customer id: ${upErr.message}` });
    }

    const base = (Deno.env.get("PWA_BASE_URL") ?? "").replace(/\/$/, "");
    const session = await createSetupCheckoutSession({
      customerId: customerId!,
      clientId: client.id,
      successUrl: base ? `${base}/?card_saved=1` : "https://stripe.com",
      cancelUrl: base ? `${base}/?card_saved=0` : "https://stripe.com",
    });
    return json(200, { url: session.url, customer_id: customerId });
  } catch (e) {
    return json(502, { error: `Stripe: ${(e as Error).message}` });
  }
});
