-- TTP Clone — Phase 1 Data Model
-- Applies to the Supabase project created for this build.
-- Table order matters: calendar_events must exist before visits (FK dependency).
-- Phase 2 tables (Clients, Dogs, Incidents, Weather) do NOT go here — see PROJECT_CONTEXT.md.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Read-only mirror of Steve's Google Calendar, ingested from the private ICS feed
-- by a scheduled edge function. The ICS URL is a credential: Supabase secrets, never the repo.
CREATE TABLE public.calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ics_uid TEXT UNIQUE NOT NULL,      -- stable UID from the ICS feed, used for upserts
    title TEXT,
    description TEXT,                   -- event body: client notes, address, gate codes etc.
    location TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    raw_ics TEXT,                       -- keep the original block; parsing loses fields
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calendar_events_starts_at ON public.calendar_events(starts_at);

-- One row per walk session.
CREATE TABLE public.visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    walker_id UUID NOT NULL REFERENCES auth.users(id),
    calendar_event_id UUID REFERENCES public.calendar_events(id),  -- nullable; matched at check-in
    dog_label TEXT,  -- free-text placeholder, e.g. "Slushy" — NOT a foreign key yet (Dogs table is Phase 2).
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled', -- scheduled, active, completed
    terrain_tag TEXT,  -- free-text, operator-entered at checkout
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    duration_minutes NUMERIC(6,2),   -- derived: check_out - check_in, computed at checkout
    distance_meters NUMERIC(10,2),   -- derived: PostGIS ST_Length over the visit's point stream
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per GPS fix. Written by the Traccar-receiver edge function (service role),
-- read by the PWA.
CREATE TABLE public.location_logs (
    id BIGSERIAL PRIMARY KEY,
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    coordinate GEOMETRY(Point, 4326) NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    speed NUMERIC(5, 2),
    battery_level NUMERIC(3, 2),
    recorded_at TIMESTAMPTZ NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_location_logs_visit_id ON public.location_logs(visit_id);
CREATE INDEX idx_location_logs_spatial ON public.location_logs USING GIST(coordinate);
CREATE INDEX idx_location_logs_chrono ON public.location_logs(recorded_at DESC);

-- Photos and video captured during a visit, stored in Supabase Storage
-- (buckets: visit-photos, visit-video; private, signed-URL access only).
CREATE TABLE public.media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
    type VARCHAR(10) NOT NULL CHECK (type IN ('photo', 'video')),
    storage_path TEXT NOT NULL,
    caption TEXT,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_visit_id ON public.media(visit_id);

-- Row Level Security — enabled from day one, on every table. See PROJECT_CONTEXT.md
-- for why this isn't covered by the "friction is acceptable" instruction (that was
-- about UX steps, not database exposure). Do not disable without an explicit Issue
-- raised and Steve's sign-off.
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "walkers manage own visits" ON public.visits
    FOR ALL USING (auth.uid() = walker_id);

CREATE POLICY "walkers manage own location logs" ON public.location_logs
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.walker_id = auth.uid())
    );

CREATE POLICY "walkers manage own media" ON public.media
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.walker_id = auth.uid())
    );

-- Calendar events: any authenticated user may read; only the ingestion edge function
-- (service role, which bypasses RLS) writes. No user-facing write policy on purpose.
CREATE POLICY "authenticated users read calendar" ON public.calendar_events
    FOR SELECT USING (auth.role() = 'authenticated');
