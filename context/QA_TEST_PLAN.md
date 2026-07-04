# Phase 1 QA / Acceptance Criteria

This is the actual test the whole build exists to pass. Run on the physical Pixel 9 Pro — never a simulator for the GPS scenarios below.

## The core test

1. Confirm today's walk appointment appears in `calendar_events` (ingested from the Google Calendar ICS feed) *before* leaving the house.
2. Start a live tracking session in the real, production Time to Pet app for an actual walk.
3. Open the PWA, authenticate, check in — and confirm check-in offers/matches today's calendar event (client name and notes visible on the visit).
4. Confirm Traccar Client is reporting (its own status screen shows successful sends).
5. Lock the screen, put the phone in a pocket.
6. Walk a real route for 30–60 minutes. Mid-walk: take at least one photo and one short video from the PWA.
7. Unlock, check out, enter a terrain note, submit.
8. Stop the TTP session.
9. Verify, in Supabase:
   - `location_logs` for the visit: continuous stream, gaps no larger than ~60 seconds during the screen-locked portion. Plot against the TTP route — same path.
   - `visits.duration_minutes` populated and plausible (matches wall-clock).
   - `visits.distance_meters` populated; compare against TTP's reported distance for the same walk — flag divergence over ~10%.
   - `media` has both files, both openable via signed URL from the correct buckets, linked to the right visit.
   - `visits.calendar_event_id` points at the right calendar event.

**Pass = all five data categories (GPS, media, timer, distance, appointment context) land in Steve's own database/storage from one real walk and are queryable together.** That's the data-ownership thesis, tested end to end.

## Additional scenarios

- **Traccar keeps reporting when the PWA is closed entirely:** kill the PWA tab/browser mid-walk. GPS should be unaffected — tracking lives in Traccar Client, not the web app. This decoupling is a *feature* of the architecture; verify it holds.
- **Dead zone:** airplane mode for 5 minutes mid-walk, then disable. Traccar Client buffers offline and resends — expect the gap to backfill within a few minutes of reconnecting. Check `recorded_at` vs `uploaded_at` on those rows to confirm buffering (they should differ).
- **Orphan pings:** confirm what happens to Traccar pings that arrive when NO visit is active (before check-in / after check-out). The edge function must handle this deliberately — reject, or log to a holding area — not error or attach them to the wrong visit.
- **Media without connectivity:** take a photo in a dead zone. Document actual behavior honestly (does the upload retry, fail silently, or block?) — a silent loss here is a Major, since media capture is a core Phase 1 deliverable.
- **Calendar edge cases:** an event with no matching visit (fine, expected), a visit checked in with no calendar match (must be allowed — ad-hoc walks are real), and a recurring event (confirm the ICS parser handles recurrence rather than only literal single events — this is the most common ICS parsing failure).
- **Thermal check:** note device temperature/throttling across a 45–60 minute walk given the Pixel 9 Pro's documented overheating history under sustained sensor work — log actual behavior, don't assume.
- **Battery drain:** note battery % at check-in and check-out. Traccar polling + camera use combined should still land well under ~5–6% for a single walk; flag anything above that.

## Architecture note for testers

Background GPS lives in Traccar Client (a separate installed app), not in the PWA. If location data stops flowing, debug Traccar's own status screen and the edge function logs first — the PWA cannot be the cause of GPS gaps, only of visit/media/calendar problems. This separation is what makes failures diagnosable.

## Severity triage

| Severity | Definition |
|---|---|
| Blocker | Prevents completing the core test end to end |
| Major | Core flow works but with wrong/lost location data |
| Minor | Cosmetic, doesn't affect data integrity |
| Defer | Correctly out of Phase 1 scope (e.g., no photo capture — expected) |

Log issues with device state noted (screen-locked vs. backgrounded vs. force-killed) — these are different failure modes with different fixes.
