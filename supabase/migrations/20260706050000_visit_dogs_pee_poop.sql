-- Per-dog pee/poop lands on the visit_dogs junction — the destination the
-- decision log promised when the pee_dogs/poop_dogs name-array bridge went
-- in (PR #28). Check-in now creates real visit_dogs rows when dogs are
-- picked from the CRM; the arrays remain the fallback for label-only
-- (ad-hoc / unregistered) walks and for every visit that predates this.

ALTER TABLE public.visit_dogs
    ADD COLUMN peed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN pooped BOOLEAN NOT NULL DEFAULT FALSE;
