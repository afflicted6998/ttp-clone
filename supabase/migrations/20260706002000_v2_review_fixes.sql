-- =============================================================================
-- Follow-up fixes from Gemini's review of PRs #17–#19
-- (report: "PR findings (gemini)/pr_review_findings 17-19.md").
--   Finding 1 (Critical): visits.walker_id NOT NULL blocks generating future
--     scheduled visits (no performer exists yet).
--   Finding 2 (High): staff table unreadable by non-admin walkers and clients,
--     so assigned-walker names silently come back NULL in the PWA.
--   Finding 3 (Medium): a walker assigned to a visit can't read the parent
--     schedule unless they are also its default_staff_id.
-- Findings 4 (timezone scope) and 5 (QBO secret hygiene) are documentation-only.
-- =============================================================================

-- ---------- 1. walker_id becomes nullable ----------
-- walker_id records who ACTUALLY performed the visit. A future scheduled visit
-- has no performer yet, and a newly added staff member may not have an auth
-- user until their first login (staff.auth_user_id is NULL by design).
ALTER TABLE public.visits ALTER COLUMN walker_id DROP NOT NULL;
COMMENT ON COLUMN public.visits.walker_id IS
    'Who actually performed the visit (auth user). NULL until someone checks in; assigned_staff_id is who is SUPPOSED to do it.';

-- ---------- 2. staff visibility ----------
-- Active staff can read the whole team roster — required for the PWA to join
-- full_name onto visits.assigned_staff_id / schedules.default_staff_id.
CREATE POLICY "staff read for staff" ON public.staff
    FOR SELECT USING (public.app_is_staff());

-- Clients can read the staff who performed / are assigned to their own visits,
-- or who are the default walker on one of their schedules. The subqueries run
-- under the client's own RLS on visits/schedules, so visibility stays
-- consistent by construction. NOTE (surfaced decision): this exposes the whole
-- staff row (email, phone) to those clients — fine at current scale; add a
-- public-profile view if staff contact info should ever be client-hidden.
CREATE POLICY "staff read for clients" ON public.staff
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.visits v
            WHERE v.client_id = public.app_client_id()
              AND (v.assigned_staff_id = public.staff.id
                   OR v.walker_id = public.staff.auth_user_id)
        )
        OR EXISTS (
            SELECT 1 FROM public.schedules s
            WHERE s.client_id = public.app_client_id()
              AND s.default_staff_id = public.staff.id
        )
    );

-- ---------- 3. serving walkers can read their clients' schedules ----------
-- Mirrors the clients/dogs visibility pattern. schedule_dogs and
-- schedule_exceptions follow automatically via their read-via-schedule
-- policies (which run under the caller's RLS on schedules).
CREATE POLICY "schedules serving walker read" ON public.schedules
    FOR SELECT USING (
        public.app_is_staff() AND public.app_walker_serves_client(client_id)
    );
