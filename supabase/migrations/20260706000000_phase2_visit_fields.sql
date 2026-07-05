-- Phase 2 (report cards) visit fields. Deliberately separated from the v2 core
-- migration so Phase 2 can apply/ship without waiting on the full schema review.
--
-- pee/poop as COUNTS not booleans (decision log, ROADMAP.md): the walk screen
-- renders them as tap-counters; Phase 8 analytics gets real per-visit numbers.

ALTER TABLE public.visits
    ADD COLUMN pee_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN poop_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN report_sent_at TIMESTAMPTZ;  -- set by the report-card sender; NULL = not yet sent

COMMENT ON COLUMN public.visits.report_sent_at IS
    'When the client report email/notification was dispatched. The Phase 2 acceptance bar is report_sent_at - check_out_time <= 60 seconds.';
