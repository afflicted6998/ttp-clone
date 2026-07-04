# Deployment Guide — from merged code to a real tracked walk

Follow top to bottom. Each step ends with **✓ You know it worked when…** — don't
move on until you see it. Total time: roughly 30–40 minutes, then the walk.

Everything here assumes SETUP_GUIDE.md Parts 1–3 are done (accounts exist,
software installed, Traccar Client on the Pixel). If not, do those first.

---

## Before you start — have these five things open

1. This repo folder in a terminal (`cd ~/Desktop/ttp-clone`)
2. Supabase dashboard (supabase.com/dashboard) — your `outside-feet-data` project
3. Your password manager
4. Vercel dashboard (vercel.com)
5. The Pixel, with Traccar Client installed

Values you'll create or copy along the way — store each in the password manager
the moment you see it:

| Value | Where it comes from |
|---|---|
| Supabase **project ref** | the dashboard URL: `supabase.com/dashboard/project/<this-part>` |
| Supabase **anon key** | Dashboard → Settings → API |
| **ICS feed URL** | Google Calendar → your walk calendar → Settings and sharing → "Secret address in iCal format" |
| **Traccar shared token** | you generate it: any 30+ character random password |
| **Traccar device id** | Traccar Client's main screen on the Pixel |

---

## Part 1 — Database: apply the migrations

**⚠️ Fork in the road:** did you already paste `context/DATA_MODEL.sql` into the
SQL Editor by hand (Setup Guide 1.2 step 3)?

**If NO (fresh project) — the normal path:**
```bash
cd ~/Desktop/ttp-clone
npx supabase login                          # opens browser, sign in
npx supabase link --project-ref <your-ref>  # asks for the DB password from setup
npx supabase db push                        # applies all 5 migrations in order
```

**If YES (tables already exist):** running `db push` would fail trying to
re-create them. Tell Claude Code — the fix is marking migration
`20260704120000` as already applied (`supabase migration repair`), then
`db push` applies only the newer four. Two minutes, but easy to fumble alone.

**✓ You know it worked when:** Dashboard → Table Editor shows five tables
(calendar_events, visits, location_logs, media, orphan_pings), and Database →
Extensions shows PostGIS enabled.

---

## Part 2 — Secrets

Dashboard → **Edge Functions → Secrets** → add all three:

| Name | Value |
|---|---|
| `ICS_FEED_URL` | the secret calendar address (ends `.ics`) |
| `TRACCAR_SHARED_TOKEN` | your generated random string |
| `TRACCAR_DEVICE_ID` | the id from Traccar Client's screen |

**✓ You know it worked when:** all three names are listed on the Secrets page.
(The receiver refuses to run without the device id — that's deliberate.)

---

## Part 3 — Deploy the two edge functions

```bash
npx supabase functions deploy traccar-receiver
npx supabase functions deploy ics-ingest
```

Then run the calendar sync once by hand (paste your real values):

```bash
curl -X POST "https://<your-ref>.supabase.co/functions/v1/ics-ingest" \
  -H "Authorization: Bearer <your-anon-key>"
```

**✓ You know it worked when:** the curl prints `{"ok":true,"events_in_window":N,...}`
and Table Editor → calendar_events shows your appointments for the next 30 days.

---

## Part 4 — Schedule the calendar sync

Dashboard → **Integrations → Cron** (install it if prompted) → **Create job**:

- Name: `ics-sync` · Schedule: `*/15 * * * *`
- Type: **Supabase Edge Function** → `ics-ingest`, method POST
- HTTP Headers: `Authorization` = `Bearer <your-anon-key>`

**✓ You know it worked when:** after 15 minutes, `calendar_events.synced_at`
values move forward (re-run the Table Editor view).

---

## Part 5 — Deploy the PWA on Vercel

1. vercel.com → **Add New → Project** → import `ttp-clone` → framework auto-detects Vite → before deploying, add two **Environment Variables**:
   - `VITE_SUPABASE_URL` = `https://<your-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon key
2. Deploy. Note the URL (something like `ttp-clone-xyz.vercel.app`).
3. Back in Supabase: Dashboard → **Authentication → URL Configuration**:
   - **Site URL** = your Vercel URL
   - **Redirect URLs** → add the same Vercel URL

**✓ You know it worked when:** opening the Vercel URL shows the "Sign in"
screen; entering your email delivers a magic-link email; tapping the link signs
you in and shows "Check in". (Do this once on the desktop first, then on the
Pixel.)

---

## Part 6 — Point the Pixel at your infrastructure

1. **Traccar Client** → server URL (one line, no spaces):
   ```
   https://<your-ref>.supabase.co/functions/v1/traccar-receiver?token=<TRACCAR_SHARED_TOKEN>
   ```
   Frequency **30** seconds · accuracy **High** · location permission **Allow all the time** → toggle tracking **ON**.
2. **The PWA**: open the Vercel URL in Chrome on the Pixel → sign in → menu ⋮ → **Add to Home Screen**.

**✓ You know it worked when (the orphan-ping smoke test):** with NO visit
checked in and Traccar running, Table Editor → `orphan_pings` grows a row every
~30 seconds. That single observation proves the URL, token, device id, and
receiver end to end. Toggle tracking OFF afterward so it doesn't drain while
you're not testing.

---

## Part 7 — The dress rehearsal (10 minutes, before the real walk)

A short loop around the block, phone in hand:

1. Check in from the PWA (pick a calendar event if one is offered, else ad-hoc; dog label e.g. `Slushy`).
2. Confirm **"GPS points received"** starts counting up (tap refresh).
3. Take one photo — watch it flip to *saved* and appear as a thumbnail.
4. Lock the screen, pocket the phone, walk 5 minutes.
5. Unlock → check out with a terrain note.
6. Tap the visit under **Past visits**: route line on the map, duration ≈ wall clock, distance plausible, photo present.

If all six hold, you're cleared for the real thing.

---

## Part 8 — The real test

Run `context/QA_TEST_PLAN.md` § "The core test" — 30–60 minute walk, live TTP
session in parallel as ground truth, screen locked, at least one photo and one
video mid-walk. Afterward verify the five categories per the plan (route vs
TTP's, duration, distance within ~10% of TTP, media via signed URLs, correct
calendar link) and note the extra scenarios worth exercising on later walks:
dead-zone (airplane mode 5 min), PWA killed mid-walk, thermal/battery notes.

**Phase 1 passes when one real walk lands all five data categories in your
own database, queryable together.** That's the whole thesis.

---

## When something misbehaves

| Symptom | First place to look |
|---|---|
| No rows in `orphan_pings` / `location_logs` | Traccar Client's own status screen; then Dashboard → Edge Functions → traccar-receiver → Logs |
| Calendar empty | re-run the Part 3 curl; check `ICS_FEED_URL` secret; feed can lag hours (known) |
| Magic link bounces to localhost | Part 5 step 3 (Auth URL configuration) |
| Photo upload fails | it will say so in red with a retry link — retry with signal; check Storage buckets exist |
| GPS gaps while locked | Traccar/Android battery optimization — exempt Traccar Client from battery saver |

Remember the architecture note from the QA plan: **GPS problems can never be
the PWA's fault** — tracking lives entirely in Traccar Client. Debug there and
in the receiver's logs, not in the app.
