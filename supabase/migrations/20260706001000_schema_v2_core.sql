-- =============================================================================
-- Schema v2 core — North Star v2 foundation (ROADMAP.md, issues #15/#16).
-- Real Clients / Dogs / Staff, multi-walker visit assignment, schedule
-- templates + exceptions, invoicing, and four-role RLS.
--
-- Design rules honored here (ROADMAP decision log):
--   * Money = integer cents. Never floats.
--   * Recurrence = RFC 5545 RRULE strings, wall-clock dtstart + timezone
--     (a 10:00 walk stays 10:00 across DST).
--   * Multi-dog visits via visit_dogs junction; visits.dog_label is legacy.
--   * Walkers see only clients they serve; admins see all; owner = admin+.
--   * All Phase-1 policies are LEFT IN PLACE (permissive policies OR
--     together), except calendar_events' — see the security fix below.
--   * FK creation order matters: staff/clients before dogs/schedules before
--     the visits ALTER (the Phase-1 FK-ordering lesson).
--   * Messaging tables are DESIGNED (DATA_MODEL_V2.md appendix) but NOT
--     migrated until Phase 7 — no dead tables in production.
-- =============================================================================

-- ---------- 1. Core people tables ----------

CREATE TABLE public.staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id),  -- NULL until they first log in
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT NOT NULL DEFAULT 'walker' CHECK (role IN ('walker', 'admin', 'owner')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE public.staff IS
    'Team members. Role hierarchy: owner ⊇ admin ⊇ walker (owner sees/does everything admin can).';

CREATE TABLE public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE REFERENCES auth.users(id),  -- NULL until the client-app phase invites them
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address TEXT,
    home_access_notes TEXT,  -- key/lockbox/gate info. Deliberately restored (fell out of scope once — PROJECT_CONTEXT known-gaps). Sensitive: walker-visible only when serving this client.
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.dogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    breed TEXT,
    birthdate DATE,
    sex TEXT,
    vet_name TEXT,
    vet_phone TEXT,
    medications TEXT,
    behavior_notes TEXT,     -- e.g. "reactive to bikes" — surfaces on the walk screen later
    emergency_contact TEXT,
    photo_path TEXT,         -- Supabase Storage path, same signed-URL pattern as media
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dogs_client_id ON public.dogs(client_id);

-- ---------- 2. Scheduling (templates now; engine activation is ROADMAP Phase 5) ----------

CREATE TABLE public.schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    label TEXT,                                  -- "MWF midday walk"
    rrule TEXT NOT NULL,                         -- RFC 5545, e.g. FREQ=WEEKLY;BYDAY=MO,WE,FR
    dtstart_local TIMESTAMP NOT NULL,            -- WALL-CLOCK first occurrence (no timezone on purpose)
    timezone TEXT NOT NULL DEFAULT 'America/New_York',
    duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
    default_staff_id UUID REFERENCES public.staff(id),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON COLUMN public.schedules.dtstart_local IS
    'Wall-clock time WITHOUT timezone, paired with the timezone column. A 10:00 walk stays 10:00 through DST transitions — converting to UTC happens at expansion time, never at storage time.';
CREATE INDEX idx_schedules_client_id ON public.schedules(client_id);

CREATE TABLE public.schedule_dogs (
    schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
    dog_id UUID NOT NULL REFERENCES public.dogs(id) ON DELETE CASCADE,
    PRIMARY KEY (schedule_id, dog_id)
);

CREATE TABLE public.schedule_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
    original_start_local TIMESTAMP NOT NULL,     -- matches an expanded occurrence's wall-clock start
    kind TEXT NOT NULL CHECK (kind IN ('skip', 'moved')),
    moved_to_local TIMESTAMP,                    -- required when kind='moved'
    note TEXT,
    created_by UUID REFERENCES public.staff(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (schedule_id, original_start_local),
    CHECK (kind <> 'moved' OR moved_to_local IS NOT NULL)
);

CREATE TABLE public.schedule_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES public.schedules(id),
    visit_id UUID REFERENCES public.visits(id),
    request TEXT NOT NULL,                       -- free text: "can we move Thursday to 3pm?"
    requested_time TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
    decided_by UUID REFERENCES public.staff(id),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_change_requests_client_status ON public.schedule_change_requests(client_id, status);

-- ---------- 3. Billing (data here, money movement in QuickBooks — ROADMAP ruling 4) ----------

CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'void')),
    issue_date DATE,
    due_date DATE,
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    qb_invoice_id TEXT,          -- QuickBooks id once synced via n8n; NULL = not yet synced
    qb_synced_at TIMESTAMPTZ,
    payment_link TEXT,           -- the QB invoice's own payment URL (we never process cards)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invoices_client_status ON public.invoices(client_id, status);

CREATE TABLE public.invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES public.visits(id),  -- the walk this line bills for, when applicable
    description TEXT NOT NULL,
    quantity NUMERIC(6,2) NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_invoice_lines_invoice_id ON public.invoice_lines(invoice_id);

-- ---------- 4. Visits: multi-walker, multi-dog, schedule linkage ----------

ALTER TABLE public.visits
    ADD COLUMN client_id UUID REFERENCES public.clients(id),          -- NULL on legacy Phase-1 rows
    ADD COLUMN assigned_staff_id UUID REFERENCES public.staff(id),    -- who is SUPPOSED to do it (walker_id = who did)
    ADD COLUMN schedule_id UUID REFERENCES public.schedules(id),
    ADD COLUMN scheduled_start TIMESTAMPTZ,                           -- the occurrence this visit realizes
    ADD COLUMN source TEXT NOT NULL DEFAULT 'adhoc' CHECK (source IN ('calendar', 'schedule', 'adhoc'));

CREATE INDEX idx_visits_client_id ON public.visits(client_id);
CREATE INDEX idx_visits_assigned_staff ON public.visits(assigned_staff_id);
-- Idempotent visit generation: the engine can never create the same occurrence twice.
CREATE UNIQUE INDEX idx_visits_schedule_occurrence
    ON public.visits(schedule_id, scheduled_start) WHERE schedule_id IS NOT NULL;

CREATE TABLE public.visit_dogs (
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    dog_id UUID NOT NULL REFERENCES public.dogs(id) ON DELETE CASCADE,
    PRIMARY KEY (visit_id, dog_id)
);
CREATE INDEX idx_visit_dogs_dog_id ON public.visit_dogs(dog_id);

-- ---------- 5. Role helper functions ----------
-- SECURITY DEFINER so policies can consult staff/clients without RLS recursion.
-- STABLE: one lookup per statement. search_path pinned (definer hygiene).

CREATE OR REPLACE FUNCTION public.app_staff_role() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT role FROM public.staff WHERE auth_user_id = auth.uid() AND active $$;

CREATE OR REPLACE FUNCTION public.app_is_staff() RETURNS BOOLEAN
LANGUAGE sql STABLE AS
$$ SELECT public.app_staff_role() IS NOT NULL $$;

CREATE OR REPLACE FUNCTION public.app_is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS
$$ SELECT COALESCE(public.app_staff_role() IN ('admin', 'owner'), FALSE) $$;

CREATE OR REPLACE FUNCTION public.app_staff_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM public.staff WHERE auth_user_id = auth.uid() AND active $$;

CREATE OR REPLACE FUNCTION public.app_client_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT id FROM public.clients WHERE auth_user_id = auth.uid() AND active $$;

-- Does the current staff user serve this client (any visit performed or assigned)?
CREATE OR REPLACE FUNCTION public.app_walker_serves_client(c UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT EXISTS (
     SELECT 1 FROM public.visits v
      WHERE v.client_id = c
        AND (v.walker_id = auth.uid() OR v.assigned_staff_id = public.app_staff_id())
   ) $$;

REVOKE EXECUTE ON FUNCTION
    public.app_staff_role(), public.app_is_staff(), public.app_is_admin(),
    public.app_staff_id(), public.app_client_id(), public.app_walker_serves_client(UUID)
    FROM anon, public;
GRANT EXECUTE ON FUNCTION
    public.app_staff_role(), public.app_is_staff(), public.app_is_admin(),
    public.app_staff_id(), public.app_client_id(), public.app_walker_serves_client(UUID)
    TO authenticated;

-- ---------- 6. Seed: existing walker(s) become owner staff ----------
-- Anyone who has performed a visit in Phase 1 is, by definition, Steve.

INSERT INTO public.staff (auth_user_id, full_name, email, role)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'Owner'), u.email, 'owner'
  FROM auth.users u
 WHERE EXISTS (SELECT 1 FROM public.visits v WHERE v.walker_id = u.id)
ON CONFLICT (auth_user_id) DO NOTHING;

-- ---------- 7. Row Level Security ----------

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_dogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_dogs ENABLE ROW LEVEL SECURITY;

-- staff: see yourself; admins manage everyone.
-- (Deliberate gap, noted: an admin could edit the owner's row. Acceptable at
--  current scale; revisit with a trigger guard when hiring an actual admin.)
CREATE POLICY "staff read self or admin" ON public.staff
    FOR SELECT USING (auth_user_id = auth.uid() OR public.app_is_admin());
CREATE POLICY "staff admin write" ON public.staff
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());

-- clients: admins all; clients their own row; walkers only clients they serve.
CREATE POLICY "clients admin all" ON public.clients
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "clients self or serving walker read" ON public.clients
    FOR SELECT USING (
        auth_user_id = auth.uid()
        OR (public.app_is_staff() AND public.app_walker_serves_client(id))
    );

-- dogs: follow the client's visibility.
CREATE POLICY "dogs admin all" ON public.dogs
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "dogs owner-client or serving walker read" ON public.dogs
    FOR SELECT USING (
        client_id = public.app_client_id()
        OR (public.app_is_staff() AND public.app_walker_serves_client(client_id))
    );

-- visits: Phase-1 policy ("walkers manage own visits", walker_id = auth.uid())
-- REMAINS. These add: admins everything; assigned walker everything on their
-- assignments; clients read their own visits.
CREATE POLICY "visits admin all" ON public.visits
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "visits assigned staff all" ON public.visits
    FOR ALL USING (assigned_staff_id IS NOT NULL AND assigned_staff_id = public.app_staff_id())
    WITH CHECK (assigned_staff_id IS NOT NULL AND assigned_staff_id = public.app_staff_id());
CREATE POLICY "visits client read own" ON public.visits
    FOR SELECT USING (client_id IS NOT NULL AND client_id = public.app_client_id());

-- location_logs / media: Phase-1 walker-own policies remain; add admin +
-- client-own-visit + assigned-staff read. (Subqueries here run under the
-- caller's own RLS on visits — visibility stays consistent by construction.)
CREATE POLICY "location_logs v2 read" ON public.location_logs
    FOR SELECT USING (
        public.app_is_admin()
        OR EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id
                    AND (v.client_id = public.app_client_id()
                         OR v.assigned_staff_id = public.app_staff_id()))
    );
CREATE POLICY "media v2 read" ON public.media
    FOR SELECT USING (
        public.app_is_admin()
        OR EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id
                    AND (v.client_id = public.app_client_id()
                         OR v.assigned_staff_id = public.app_staff_id()))
    );

-- visit_dogs: readable wherever the parent visit is readable; writable by the
-- visit's own/assigned walker or an admin.
CREATE POLICY "visit_dogs read via visit" ON public.visit_dogs
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id));
CREATE POLICY "visit_dogs write via own visit" ON public.visit_dogs
    FOR ALL USING (
        public.app_is_admin()
        OR EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id
                    AND (v.walker_id = auth.uid() OR v.assigned_staff_id = public.app_staff_id()))
    ) WITH CHECK (
        public.app_is_admin()
        OR EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id
                    AND (v.walker_id = auth.uid() OR v.assigned_staff_id = public.app_staff_id()))
    );

-- schedules: admins manage; default-assigned walker and the client can read.
CREATE POLICY "schedules admin all" ON public.schedules
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "schedules assigned or client read" ON public.schedules
    FOR SELECT USING (
        (default_staff_id IS NOT NULL AND default_staff_id = public.app_staff_id())
        OR client_id = public.app_client_id()
    );

CREATE POLICY "schedule_dogs admin all" ON public.schedule_dogs
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "schedule_dogs read via schedule" ON public.schedule_dogs
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id));

CREATE POLICY "schedule_exceptions admin all" ON public.schedule_exceptions
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "schedule_exceptions read via schedule" ON public.schedule_exceptions
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_id));

-- change requests: clients create (pending only) and read their own; admins decide.
CREATE POLICY "change_requests admin all" ON public.schedule_change_requests
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "change_requests client read own" ON public.schedule_change_requests
    FOR SELECT USING (client_id = public.app_client_id());
CREATE POLICY "change_requests client create pending" ON public.schedule_change_requests
    FOR INSERT WITH CHECK (client_id = public.app_client_id() AND status = 'pending');

-- invoices: admins manage; clients read their own. Walkers: no access.
CREATE POLICY "invoices admin all" ON public.invoices
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "invoices client read own" ON public.invoices
    FOR SELECT USING (client_id = public.app_client_id());

CREATE POLICY "invoice_lines admin all" ON public.invoice_lines
    FOR ALL USING (public.app_is_admin()) WITH CHECK (public.app_is_admin());
CREATE POLICY "invoice_lines client read via invoice" ON public.invoice_lines
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_id));

-- ---------- 8. SECURITY FIX: calendar_events was readable by ANY authenticated user ----------
-- Fine when the only user was Steve; wrong the moment clients can log in —
-- they'd see the whole business calendar. Staff-only from now on.

DROP POLICY "authenticated users read calendar" ON public.calendar_events;
CREATE POLICY "calendar staff read" ON public.calendar_events
    FOR SELECT USING (public.app_is_staff());
