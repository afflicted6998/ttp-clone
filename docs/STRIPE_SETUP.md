# Stripe setup — pre-payment gate (issue #40)

This is the checklist for turning on the Stripe pre-payment gate. You do the
account/keys steps; the code (edge functions, PWA wiring) is built in the
`feat/payments-*` / `feat/stripe-*` PR train.

**The rule this implements:** no walk starts unpaid. A client saves a card once
at onboarding; each booking auto-charges that saved card (issue #40 rulings,
2026-07-07). No card number ever touches our database — Stripe hosts all card
entry, so we stay at zero PCI scope.

---

## 1. Secrets to add in Supabase (Edge Functions → Secrets)

Add these in the Supabase dashboard, not the repo. Use **test-mode** keys first
so we can verify the whole flow without moving real money; swap to live keys
only after a clean test run.

| secret | where to get it | notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe dashboard → toggle **Test mode** on → Developers → API keys → **Secret key** (`sk_test_…`) | the key that lets our functions talk to Stripe |
| `STRIPE_WEBHOOK_SECRET` | created in step 3 below (`whsec_…`) | proves an incoming webhook really came from Stripe |
| `PWA_BASE_URL` | your deployed app URL (e.g. `https://outsidefeet.vercel.app`) | already used by report-card; Stripe redirects back here after a card is saved |

The **publishable** key (`pk_test_…`) is not secret and is not needed yet — the
card-save flow uses Stripe's own hosted page (Checkout), so the app never loads
Stripe.js.

## 2. One toggle in Stripe

- Dashboard → Settings → Payments → make sure **card** payments are on. (ACH
  can be added later for standing clients — issue #40's cost note — but is not
  in this first build.)

## 3. Create the webhook endpoint

After the `stripe-webhook` function is deployed (its URL will be
`https://<project>.supabase.co/functions/v1/stripe-webhook`):

1. Stripe dashboard → Developers → **Webhooks** → **Add endpoint**.
2. Endpoint URL = the function URL above.
3. Select events to send:
   - `checkout.session.completed`  (a client finished saving their card)
   - `payment_intent.succeeded`    (a booking charge went through)
   - `payment_intent.payment_failed` (a card declined)
   - `charge.refunded`             (you refunded a charge)
4. Save, then copy the endpoint's **Signing secret** (`whsec_…`) into the
   `STRIPE_WEBHOOK_SECRET` Supabase secret from step 1.

## 4. How the pieces fit (for reference)

```
Onboarding a client:
  Admin taps "Save card on file" → stripe-save-card function makes a Stripe
  Checkout link (setup mode) → client enters card on Stripe's page →
  Stripe calls stripe-webhook → we set clients.card_on_file = TRUE.

Booking a walk:
  Admin books a visit with a service (price) → stripe-charge-booking charges
  the saved card off-session → visit.payment_status = 'paid'.
  Card declines → visit stays 'unpaid'; check-in is blocked until you either
  retry successfully or use the admin override (which flags the visit unpaid).
```

## 5. Test-mode card numbers (Stripe provides these)

- Success: `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
- Decline: `4000 0000 0000 0002`.
- Use these while `sk_test_…` is the secret — no real charges occur.

Once a full cycle works in test mode (save a card, book a walk, see it charge,
try a declining card, use the override), swap the two Stripe secrets for their
live (`sk_live_…` / live `whsec_…`) values and repeat one small real charge.
