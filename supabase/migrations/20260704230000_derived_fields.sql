-- Derived fields (PROJECT_CONTEXT: "Timer/distance are derived, not captured").
-- Computed in the database, not the client, so the numbers are trustworthy
-- regardless of what app or agent touches the row:
--   duration_minutes = check_out_time - check_in_time
--   distance_meters  = ST_Length over the visit's GPS points in time order,
--                      cast to geography so the result is meters (plain 4326
--                      geometry length would be degrees).
--
-- Two triggers because points can arrive AFTER checkout: Traccar Client
-- buffers offline and backfills (QA dead-zone scenario). If Steve checks out
-- before the backfill lands, the checkout-time distance would silently miss
-- those points — so late inserts on a completed visit recompute it.

CREATE OR REPLACE FUNCTION public.visit_derived_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    -- ELSE branches clear the fields when checkout is undone (check_out_time
    -- back to NULL) — otherwise a re-activated visit would keep showing its
    -- old completed numbers (Gemini PR #9 review, finding 3).
    IF NEW.check_out_time IS NOT NULL AND NEW.check_in_time IS NOT NULL THEN
        NEW.duration_minutes := ROUND(
            EXTRACT(EPOCH FROM (NEW.check_out_time - NEW.check_in_time)) / 60.0, 2);
    ELSE
        NEW.duration_minutes := NULL;
    END IF;
    IF NEW.check_out_time IS NOT NULL THEN
        SELECT ROUND(COALESCE(
                   ST_Length(ST_MakeLine(l.coordinate ORDER BY l.recorded_at)::geography),
                   0)::numeric, 2)
          INTO NEW.distance_meters
          FROM public.location_logs l
         WHERE l.visit_id = NEW.id;
    ELSE
        NEW.distance_meters := NULL;
    END IF;
    RETURN NEW;
END $$;

-- Fires on check_in_time changes too: correcting a completed visit's
-- check-in must recompute duration (Gemini PR #9 review, finding 2).
CREATE TRIGGER trg_visit_derived_fields
    BEFORE UPDATE ON public.visits
    FOR EACH ROW
    WHEN (NEW.check_out_time IS DISTINCT FROM OLD.check_out_time
          OR NEW.check_in_time IS DISTINCT FROM OLD.check_in_time)
    EXECUTE FUNCTION public.visit_derived_fields();

-- Late-arriving points (offline backfill) on an already-completed visit:
-- recompute distance. For active visits the UPDATE matches zero rows and
-- costs one indexed lookup per ping.
CREATE OR REPLACE FUNCTION public.backfill_visit_distance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.visits v
       SET distance_meters = (
               SELECT ROUND(COALESCE(
                          ST_Length(ST_MakeLine(l.coordinate ORDER BY l.recorded_at)::geography),
                          0)::numeric, 2)
                 FROM public.location_logs l
                WHERE l.visit_id = NEW.visit_id),
           updated_at = NOW()
     WHERE v.id = NEW.visit_id
       AND v.check_out_time IS NOT NULL;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_backfill_visit_distance
    AFTER INSERT ON public.location_logs
    FOR EACH ROW
    EXECUTE FUNCTION public.backfill_visit_distance();
