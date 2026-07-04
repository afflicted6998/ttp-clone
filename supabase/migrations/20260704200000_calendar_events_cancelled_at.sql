-- Soft-cancellation for calendar_events. Addition beyond context/DATA_MODEL.sql,
-- requested by Steve after reviewing the linger-on-cancel trade-off in PR #5:
-- events cancelled in Google should stop being offered at check-in, but rows
-- are never deleted (a visit may already reference them).
--
-- NULL = event is live in the Google feed.
-- Set  = the ingestion sync noticed the event vanished from the feed
--        (or Google marked it STATUS:CANCELLED). Cleared automatically if
--        the event reappears.

ALTER TABLE public.calendar_events
    ADD COLUMN cancelled_at TIMESTAMPTZ;
