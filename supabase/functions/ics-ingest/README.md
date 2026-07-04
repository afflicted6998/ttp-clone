# ICS ingestion — deploy & scheduling

What this is: mirrors your Google Calendar (via its secret ICS address) into
the `calendar_events` table, so check-in can offer today's appointment.
Read-only — it never writes anything back to Google.

## One-time deploy (Steve, ~5 minutes)

1. **Set the secret** — Supabase Dashboard → Edge Functions → Secrets:
   - `ICS_FEED_URL`: the "Secret address in iCal format" from Google Calendar
     settings (Setup Guide 1.3). This URL exposes your whole calendar —
     password manager, never the repo.

2. **Deploy** — from the repo root (after `supabase link`, same as the
   Traccar receiver):
   ```
   npx supabase functions deploy ics-ingest
   ```

3. **Schedule it** — Supabase Dashboard → Integrations → Cron → install if
   prompted → Create job:
   - Schedule: `*/15 * * * *` (every 15 minutes — plenty, since Google
     updates the secret feed with a lag of up to hours anyway)
   - Type: Supabase Edge Function → `ics-ingest`, method POST
   - HTTP Headers: add `Authorization: Bearer <your anon key>`
     (Dashboard → Settings → API. The anon key is the *publishable* one —
     this is fine; it only proves the call comes from your project.)

## How to tell it's working

Run it once by hand and look at the response:
```
curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/ics-ingest" \
  -H "Authorization: Bearer <your anon key>"
```
You should get `{"ok":true,"events_in_window":N,...}` and see rows in
`calendar_events` (Table Editor) matching your next 30 days of appointments.

## Behavior notes

- **Window:** yesterday through +30 days. Events further out appear as the
  window rolls forward.
- **Recurring events** are expanded into individual rows; each instance's
  `ics_uid` is `<UID>:<original scheduled time>`, so a rescheduled instance
  updates its existing row instead of duplicating.
- **Cancellations are soft:** an event cancelled in Google after ingestion
  keeps its row (a visit may already be linked to it) but gets
  `cancelled_at` set — either because Google marks it `STATUS:CANCELLED`
  in the feed, or because it simply vanished from the feed (the sync flags
  window events it no longer sees). Check-in only offers events where
  `cancelled_at IS NULL`. If you un-cancel an event in Google, the flag
  clears on the next sync. Safety guard: a sync that parses zero events
  (broken/truncated feed) skips the cancellation sweep entirely, so a bad
  fetch can never mass-cancel your calendar.
