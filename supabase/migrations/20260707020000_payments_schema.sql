-- =============================================================================
-- Stripe pre-payment gate — data model (issue #40 ruling, reverses ROADMAP
-- ruling 4's "clients pay through the QuickBooks payment link" model).
--
-- The gate: no walk starts unpaid. A booked visit carries a price and a
-- payment_status; check-in refuses an 'unpaid' visit unless an admin overrides
-- it (recording who/when/why). Charging is off-session against a card the
-- client saved once at onboarding — "auto-charge only" (Steve, 2026-07-07).
--
-- PCI boundary (unchanged spirit of ruling 4): NO card data ever touches this
-- database. Stripe hosts all card entry; we store only Stripe's opaque ids
-- (cus_…, pm_…, pi_…, ch_…). Money = integer cents, never floats.
-- =============================================================================

-- ---------- 1. Clients gain a Stripe customer + saved-card state ----------
ALTER TABLE public.clients
    ADD COLUMN stripe_customer_id TEXT,          -- cus_…, created on first card-save
    ADD COLUMN default_payment_method_id TEXT,   -- pm_… of the saved card (the one we charge)
    ADD COLUMN card_on_file BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.clients.card_on_file IS
    'TRUE once a Stripe SetupIntent/Checkout(setup) succeeds and a payment
     method is saved. Booking is blocked until this is TRUE (auto-charge-only
     ruling, issue #40).';

-- ---------- 2. One row per charge attempt against Stripe ----------
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id),
    visit_id UUID REFERENCES public.visits(id),   -- the walk being paid for; NULL for manual/credit
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'canceled')),
    stripe_payment_intent_id TEXT,   -- pi_…, set when the intent is created at Stripe
    stripe_charge_id TEXT,           -- ch_…, set on success (needed to issue refunds)
    description TEXT,
    error_message TEXT,              -- Stripe's decline reason when status='failed'
    created_by UUID REFERENCES public.staff(id),  -- the admin who triggered the charge (NULL = webhook/system)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_client ON public.payments(client_id);
CREATE INDEX idx_payments_visit ON public.payments(visit_id);
-- One local row per Stripe PaymentIntent — lets the webhook upsert idempotently
-- (Stripe can deliver the same event more than once).
CREATE UNIQUE INDEX idx_payments_intent
    ON public.payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

-- ---------- 3. Visits carry price + gate state ----------
-- payment_status vocabulary:
--   not_required — ad-hoc/test/legacy walk, outside the gate (DEFAULT so no
--                  existing Phase-1 row and no admin ad-hoc check-in is flagged).
--   unpaid       — a booked visit awaiting a successful charge (blocks check-in).
--   paid         — charge succeeded.
--   override     — admin let it proceed despite a missing/failed charge; the
--                  visible "unpaid" flag, with who/when/why recorded.
--   refunded     — money returned after the fact.
ALTER TABLE public.visits
    ADD COLUMN service_id UUID REFERENCES public.services(id),
    ADD COLUMN price_cents INTEGER,               -- copied from the service at booking (price-history stability)
    ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (payment_status IN ('not_required', 'unpaid', 'paid', 'override', 'refunded')),
    ADD COLUMN payment_id UUID REFERENCES public.payments(id),
    ADD COLUMN payment_override_by UUID REFERENCES public.staff(id),
    ADD COLUMN payment_override_at TIMESTAMPTZ,
    ADD COLUMN payment_override_reason TEXT;
CREATE INDEX idx_visits_payment_status ON public.visits(payment_status);

-- ---------- 4. RLS ----------
-- Payments are admin-scope. Clients read their own (Phase 6 client app shows
-- payment history). Walkers get NO access — a walker never sees billing.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments admin all" ON public.payments
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "payments client read own" ON public.payments
    FOR SELECT USING (client_id = public.app_client_id());
