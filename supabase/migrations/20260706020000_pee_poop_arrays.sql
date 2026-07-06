-- Per-pet pee/poop yes/no (Steve's ruling 2026-07-06, reversing the earlier
-- "counts, not booleans" decision-log entry — he needs a TTP-style yes/no per
-- dog, not tap counters).
--
-- Bridge representation: text arrays of dog names parsed from the free-text
-- dog_label ("Samson and Reba"), NOT the visit_dogs junction — the dogs table
-- has no rows and no CRM screens until Phase 3. When check-in starts creating
-- real visit_dogs rows, these arrays migrate to peed/pooped booleans on the
-- junction and this bridge is retired (tracked in the decision log).
--
-- Deliberately ADDITIVE (review fix): pee_count/poop_count are dropped in a
-- follow-up cleanup migration only after the array UI is deployed, so the
-- currently deployed PWA (which still selects the count columns) never breaks.

ALTER TABLE public.visits
    ADD COLUMN pee_dogs text[] NOT NULL DEFAULT '{}',
    ADD COLUMN poop_dogs text[] NOT NULL DEFAULT '{}';
