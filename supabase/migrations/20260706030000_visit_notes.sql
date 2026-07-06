-- The personal message to the client — the heart of the real TTP report
-- Steve exported ("TTP Example Report … Samson, Reba": his note IS the
-- report; everything else is trimmings). The walk screen collects it at
-- checkout; the report-card email renders it as the narrative block. The
-- deferred AI care-report text (issue #24 ruling) will DRAFT this, never
-- replace it — the walker always has the final word.

ALTER TABLE public.visits
    ADD COLUMN visit_notes TEXT;
