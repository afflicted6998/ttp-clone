-- Storage buckets + policies for visit media (PROJECT_CONTEXT: two private
-- buckets, visit-photos and visit-video, signed-URL access only).
--
-- Buckets: idempotent insert — SETUP_GUIDE 1.2 step 4 may have already
-- created them by hand; this makes the repo the source of truth either way.
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', false),
       ('visit-video', 'visit-video', false)
ON CONFLICT (id) DO NOTHING;

-- Objects are stored under <visit_id>/<filename>. The policies gate every
-- operation on owning the visit in the path's first folder — same ownership
-- chain as the media/location_logs table policies in the initial schema.
CREATE POLICY "walkers upload media for own visits" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id IN ('visit-photos', 'visit-video')
        AND EXISTS (
            SELECT 1 FROM public.visits v
            WHERE v.id::text = (storage.foldername(name))[1]
              AND v.walker_id = auth.uid()
        )
    );

CREATE POLICY "walkers read media for own visits" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id IN ('visit-photos', 'visit-video')
        AND EXISTS (
            SELECT 1 FROM public.visits v
            WHERE v.id::text = (storage.foldername(name))[1]
              AND v.walker_id = auth.uid()
        )
    );

-- UPDATE too: retry-after-partial-failure re-uploads to the SAME path with
-- upsert, which is an UPDATE on the existing object — without this policy
-- the retry dies with 42501 permission denied (Gemini PR #8 review, finding 1).
CREATE POLICY "walkers update media for own visits" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id IN ('visit-photos', 'visit-video')
        AND EXISTS (
            SELECT 1 FROM public.visits v
            WHERE v.id::text = (storage.foldername(name))[1]
              AND v.walker_id = auth.uid()
        )
    )
    WITH CHECK (
        bucket_id IN ('visit-photos', 'visit-video')
        AND EXISTS (
            SELECT 1 FROM public.visits v
            WHERE v.id::text = (storage.foldername(name))[1]
              AND v.walker_id = auth.uid()
        )
    );
