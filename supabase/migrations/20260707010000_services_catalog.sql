-- =============================================================================
-- Service catalog — priced offerings a booking references (issue #40 ruling:
-- "service catalog", TTP-style: "30-minute walk $28").
--
-- Why: the Phase 4 invoice screen made the admin type a price per line by hand.
-- The Stripe pre-payment gate (issue #40) needs a price the system can LOOK UP
-- at booking time to auto-charge — a typed-by-hand price can't gate a walk.
--
-- Design rules honored (schema v2 decision log):
--   * Money = integer cents. Never floats.
--   * RLS on from creation. Admins manage; staff and clients may READ (the
--     Phase 6 client app shows prices at booking; the report/booking UIs join
--     the service name onto visits).
-- =============================================================================

CREATE TABLE public.services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                                      -- "30-minute walk"
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),   -- integer cents, never floats
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,                   -- display ordering in the picker
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.services IS
    'Priced offerings a booking references. price_cents is the catalog price; a
     visit COPIES it into visits.price_cents at booking so later catalog edits
     never rewrite the amount a client was already charged.';

-- A schedule template's default service (its price flows to generated visits).
ALTER TABLE public.schedules
    ADD COLUMN service_id UUID REFERENCES public.services(id);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

-- Admins (and owner) manage the catalog.
CREATE POLICY "services admin all" ON public.services
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- Any staff member or any logged-in client may read it. The catalog is not
-- sensitive; UIs filter active=true for the client-facing picker.
CREATE POLICY "services read for staff or client" ON public.services
    FOR SELECT USING (
        public.app_is_staff() OR public.app_client_id() IS NOT NULL
    );
