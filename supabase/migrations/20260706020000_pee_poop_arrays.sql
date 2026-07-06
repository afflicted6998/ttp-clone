-- Shift pee/poop tracking from scalar counters to per-pet yes/no booleans.
-- Using text arrays allows us to store the names of the dogs that peed/pooped,
-- which handles multiple dogs (like "Samson and Reba" from dog_label) easily
-- before the full Phase 5 `visit_dogs` schema is wired into the PWA.

ALTER TABLE public.visits
    DROP COLUMN pee_count,
    DROP COLUMN poop_count,
    ADD COLUMN pee_dogs text[] NOT NULL DEFAULT '{}',
    ADD COLUMN poop_dogs text[] NOT NULL DEFAULT '{}';
