// Minimal Stripe REST client for Supabase edge functions (Deno).
//
// We call Stripe's HTTP API directly with fetch rather than pulling the Node
// SDK: every call here is a form-encoded POST/GET, and fewer dependencies means
// fewer surprises in the edge runtime.
//
// SECURITY:
//   * The secret key lives ONLY in the STRIPE_SECRET_KEY edge secret, never the
//     repo, never the browser.
//   * No card data ever passes through here — Stripe hosts all card entry
//     (Checkout in setup mode). We handle only opaque ids (cus_/pm_/pi_/ch_).
//   * Incoming webhooks are authenticated by verifyStripeSignature (HMAC over
//     the raw body), NOT a Supabase JWT — Stripe has none.

const STRIPE_API = "https://api.stripe.com/v1";

export interface StripeError extends Error {
  stripeCode?: string;
  declineCode?: string;
  httpStatus?: number;
}

function secretKey(): string {
  const k = Deno.env.get("STRIPE_SECRET_KEY");
  if (!k) throw new Error("STRIPE_SECRET_KEY is not set");
  return k;
}

// Stripe wants application/x-www-form-urlencoded, including bracketed nested
// keys like metadata[visit_id]=…. Callers pass those bracket keys literally.
export function encodeForm(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) p.append(k, String(v));
  }
  return p.toString();
}

// deno-lint-ignore no-explicit-any
type Json = any;

async function stripeRequest(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string | number | boolean | undefined | null>,
  idempotencyKey?: string,
): Promise<Json> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  // Idempotency keys make a retried POST safe — Stripe returns the original
  // result instead of charging twice (crucial for the booking charge).
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const qs = params ? encodeForm(params) : "";
  const url = method === "GET" && qs ? `${STRIPE_API}${path}?${qs}` : `${STRIPE_API}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? qs : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    const e = json?.error ?? {};
    const err = new Error(e.message ?? `Stripe ${res.status}`) as StripeError;
    err.stripeCode = e.code;
    err.declineCode = e.decline_code;
    err.httpStatus = res.status;
    throw err;
  }
  return json;
}

export function createCustomer(p: {
  email?: string | null;
  name?: string | null;
  clientId: string;
}): Promise<Json> {
  return stripeRequest("POST", "/customers", {
    email: p.email ?? undefined,
    name: p.name ?? undefined,
    "metadata[client_id]": p.clientId,
  });
}

// Hosted card-save page (no card fields in our app). success/cancel bounce back
// to the PWA. The saved method attaches to the customer via the webhook.
export function createSetupCheckoutSession(p: {
  customerId: string;
  successUrl: string;
  cancelUrl: string;
  clientId: string;
}): Promise<Json> {
  return stripeRequest("POST", "/checkout/sessions", {
    mode: "setup",
    customer: p.customerId,
    "payment_method_types[0]": "card",
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    "metadata[client_id]": p.clientId,
  });
}

export function retrieveSetupIntent(id: string): Promise<Json> {
  return stripeRequest("GET", `/setup_intents/${id}`);
}

// Make a saved method the customer's default for future off-session charges.
export function setCustomerDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<Json> {
  return stripeRequest("POST", `/customers/${customerId}`, {
    "invoice_settings[default_payment_method]": paymentMethodId,
  });
}

// Off-session charge of a saved card, confirmed immediately. Throws a
// StripeError (with declineCode) if the card is declined or needs auth.
export function chargeOffSession(p: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  visitId: string;
  clientId: string;
  description?: string;
  idempotencyKey: string;
}): Promise<Json> {
  return stripeRequest(
    "POST",
    "/payment_intents",
    {
      amount: p.amountCents,
      currency: p.currency,
      customer: p.customerId,
      payment_method: p.paymentMethodId,
      off_session: true,
      confirm: true,
      description: p.description,
      "metadata[visit_id]": p.visitId,
      "metadata[client_id]": p.clientId,
    },
    p.idempotencyKey,
  );
}

export function createRefund(chargeId: string): Promise<Json> {
  return stripeRequest("POST", "/refunds", { charge: chargeId });
}

// ---------- Webhook signature verification ----------
// Mirrors Stripe's constructEvent: HMAC-SHA256 of `${t}.${rawBody}` keyed by
// the endpoint signing secret, constant-time compared to the v1 signature(s),
// within a replay tolerance. Throws on any mismatch; returns the parsed event.

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time string compare (equal-length hex). Avoids leaking match
// position via early return.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<Json> {
  if (!sigHeader) throw new Error("missing Stripe-Signature header");

  // Header: "t=NNN,v1=hex,v1=hex,v0=…". Collect the timestamp and every v1.
  let t: string | undefined;
  const v1s: string[] = [];
  for (const part of sigHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1s.push(v);
  }
  if (!t || v1s.length === 0) throw new Error("malformed Stripe-Signature header");

  const age = Math.floor(Date.now() / 1000) - Number(t);
  if (!Number.isFinite(age) || Math.abs(age) > toleranceSeconds) {
    throw new Error("Stripe-Signature timestamp outside tolerance");
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${rawBody}`));
  const expected = hex(new Uint8Array(mac));

  if (!v1s.some((sig) => timingSafeEqual(expected, sig))) {
    throw new Error("Stripe-Signature verification failed");
  }
  return JSON.parse(rawBody);
}
