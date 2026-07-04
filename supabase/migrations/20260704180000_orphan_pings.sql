-- Holding table for Traccar pings that arrive when NO visit is active
-- (before check-in, after check-out, forgotten sessions). Deliberate policy
-- per QA_TEST_PLAN.md "orphan pings" scenario; decision surfaced in issue #2:
-- keep the data rather than discard it. NOT part of context/DATA_MODEL.sql —
-- this table is receiver plumbing, not a Phase 1 data category.

CREATE TABLE public.orphan_pings (
    id BIGSERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    recorded_at TIMESTAMPTZ,
    raw_params TEXT,                    -- full query string as received (token stripped)
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on, and deliberately NO policies: only the receiver edge function
-- (service role, bypasses RLS) writes, and reading happens via the Supabase
-- dashboard. The PWA has no business with this table.
ALTER TABLE public.orphan_pings ENABLE ROW LEVEL SECURITY;
