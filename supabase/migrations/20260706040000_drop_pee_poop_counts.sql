-- Cleanup: retire the counter columns the per-pet ruling replaced (PR #28
-- decision log). The additive arrays migration deliberately left these in
-- place so the previously deployed PWA never broke; nothing on main reads
-- them anymore.
--
-- APPLY ONLY AFTER confirming the deployed PWA is the array UI (open the
-- app, walk screen shows per-dog Pee/Poop toggles) — an older cached bundle
-- still selects these columns and would start erroring.

ALTER TABLE public.visits
    DROP COLUMN pee_count,
    DROP COLUMN poop_count;
