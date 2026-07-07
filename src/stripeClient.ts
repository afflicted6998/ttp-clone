import { supabase } from "./supabase";

// Thin wrappers over the Stripe edge functions. These call functions that hold
// the Stripe secret key server-side — the browser never sees it, and no card
// data ever flows through here (card entry happens on Stripe's hosted page).
//
// supabase.functions.invoke reports a non-2xx as `error`, but our functions put
// the human-readable reason in the JSON body (e.g. a decline message on 402).
// We dig it out of error.context (the underlying Response) so the admin sees
// "card declined: insufficient funds", not a bare "non-2xx".

async function invoke<T>(
  fn: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } catch {
        /* body wasn't our JSON shape — keep the generic message */
      }
    }
    return { data: null, error: msg };
  }
  return { data: data as T, error: null };
}

// Returns a Stripe-hosted URL where the client saves a card. Open it (or send
// it to the client). card_on_file flips true via the webhook once they finish.
export function saveCard(clientId: string) {
  return invoke<{ url: string; customer_id: string }>("stripe-save-card", { client_id: clientId });
}

// Charges the client's saved card for a booked visit. paid=true → visit is now
// 'paid'. A decline comes back as an error string (the reason) with the visit
// left 'unpaid'.
export function chargeBooking(visitId: string) {
  return invoke<{ paid: boolean; status?: string; already_paid?: boolean; amount_cents?: number }>(
    "stripe-charge-booking",
    { visit_id: visitId },
  );
}
