# Project Context — TTP Clone (Outside Feet Operations Prototype)

> **North Star v2 (2026-07-05):** Phase 1 passed its real-world test (issue #15) and
> the goal expanded: this is now building toward a **full Time To Pet replacement** —
> owned core + external satellites, two private apps (Client + Team) with four roles,
> never on the public store. The authoritative plan, phase gates, binding rulings, and
> model-routing table live in **`context/ROADMAP.md`**; the origin brief is
> `context/FABLE_KICKOFF_PROMPT.md` (issues #15/#16 record the decisions). Where this
> file's Phase-1-era scoping conflicts with ROADMAP.md, ROADMAP.md wins. Phase 1
> sections below are kept as history and as still-valid architectural ground truth.

## Background

Outside Feet is a solo-operator dog-walking business (Washington DC / Montgomery County, MD) currently running on Time to Pet (TTP), a commercial SaaS product. This repo is building a self-owned replacement, one proven capability at a time — not a full clone in one pass. The founder (Steve) directs this build through AI coding agents and is not a professional developer.

This project went through several candidate architectures before the current one: Solution 1 (Capacitor + React hybrid with a custom-built background GPS layer) and Solution 2 (fully native Kotlin/Jetpack Compose) were both evaluated and set aside — Solution 2's offline local-cache pattern remains worth referencing. The current architecture replaced both after recognizing that continuous background GPS is a commodity, already-solved problem (Traccar) and that building it custom re-proves a vendor's product instead of testing Steve's actual hypothesis, which is about data ownership.

## Phase 1 goal — ✅ COMPLETE 2026-07-05 (pass record: issue #15)

**Prove data ownership.** Steve's core frustration with Time to Pet is that it captures data he cannot get out: no GPS export, media files require manual workarounds, visit metadata is locked in their system. Phase 1 proves that every category of data TTP hoards can be captured into infrastructure Steve owns:

1. **Continuous background GPS** for a real 30–60 minute walk (screen locked, phone in pocket), validated against a live TTP session on the same walk as ground truth. Captured via Traccar Client → Supabase edge function → `location_logs`.
2. **Photos and video** captured during a visit from the PWA (mobile browser camera capture), landing directly in Steve's own Supabase Storage, linked to the visit row. No extraction workaround — the file is Steve's from the moment it's taken.
3. **Visit timer and distance** — derived fields, not new capture machinery. Duration = check-out minus check-in. Distance = PostGIS computation over the visit's GPS point stream.
4. **Appointment context from Google Calendar** — read-only ingestion of Steve's calendar via the private ICS feed URL (no OAuth, no GCP app setup in Phase 1), so a visit knows which appointment it belongs to (client name, time, notes from the event body).

Success = one real visit, end to end, where all four data categories land in Steve's own database/storage and are queryable together. UI polish is explicitly not being evaluated.

**Target device: a physical Pixel 9 Pro.** Note: this device has a documented history of overheating and feature shutdown under sustained continuous *video* recording, particularly in warm outdoor conditions. That's a different workload than GPS-only polling, but it's the same device and the same season — treat sustained thermal behavior under aggressive GPS polling as something to actually check, not assume away.

## Explicit non-goals for Phase 1 (historical — dispositions now in ROADMAP.md)

- Weather API enrichment, terrain data beyond a free-text note
- Automated care-report generation and client delivery of media (capture is Phase 1; presentation to clients is Phase 2)
- Clients table, Dogs table (beyond a placeholder label), native scheduling (calendar *ingestion* is Phase 1; calendar *management* stays in Google Calendar/TTP)
- Two-way Google Calendar sync or the full Calendar API (Phase 1 is read-only ICS)
- UI/UX polish, brand styling, input validation, error-recovery states
- Billing or payment
- iOS — Android-first by design

## Known gaps vs. Time to Pet (tracked so they don't silently vanish)

Phase 1+2 as currently planned still does NOT replace these TTP features. This list exists because features have already fallen out of scope silently once (key/lockbox management). Nothing may be removed from this list without an explicit note of where it went.

| TTP feature | Status in this project |
|---|---|
| Client messaging / conversation feed | **Committed: ROADMAP Phase 7** (in-app threads + push). Text/email until then. |
| Schedule change requests & approvals | **Committed: ROADMAP Phase 6** (client app, request + approval workflow). |
| Key / lockbox management | **Revisit at Phase 3** (a field on the client record in schema v2 — see DATA_MODEL_V2). No longer allowed to vanish. |
| Staff ops (availability, time-off, pay rates, walker notifications) | **Foundation in schema v2** (staff table, assignment); full ops UI when hiring is imminent. Pay/payroll stays external. |
| Client onboarding (intake forms, agreements, e-signatures) | **Revisit at ROADMAP Phase 6**; e-signatures stay external permanently. |
| Business reporting dashboards | **Committed: ROADMAP Phases 3 (basic rollups) and 8 (AI analysis).** |
| Push notifications (either direction) | **Committed: ROADMAP Phase 7** (the trigger for the Capacitor wrap). |
| Invoicing / payments / client billing app | **REVERSED 2026-07-05 (issue #16): invoicing data in-house (ROADMAP Phase 4), synced to QuickBooks via n8n. Card processing stays external permanently** — clients pay through QB payment links. |
| Native scheduling & recurring visits | **Split per ROADMAP ruling 3:** assignment Phase 3, change-requests Phase 6, engine core built in foundation sprint, activation Phase 5. Google Calendar carries it until activation. |
| Pet profiles (vet, meds, behavior, emergency contacts) | **Schema v2 now (Dogs table); CRM screens ROADMAP Phase 3.** |
| Client-facing report cards & media delivery | **Phase 2 — the locked next build.** |

**Strategic implication (rewritten 2026-07-05, superseding the original):** this project
IS building the TTP replacement. The original paragraph here scoped conservatively
because Phase 1 was unproven; Phase 1 passing changed the calculus (Steve's ruling,
issue #16). The end state: TTP subscription cancelled, every business record in
Steve-owned infrastructure, money movement and e-signatures composed from external
services. The gate for actually cancelling TTP is the checklist in `ROADMAP.md`.

## Explicitly accepted for Phase 1

- Multiple manual steps, multiple logins, general friction — the tester is validating a hypothesis, not using a polished product yet.
- No battery-driven polling throttling — auxiliary charging is assumed during testing.

## Architecture decisions already made — build to these, don't relitigate them

- **Background GPS: Traccar Client (free, open-source, Play Store), NOT a custom-built tracker.** Continuous background location is a commodity, solved problem — building it custom (Capacitor + TransistorSoft) was the original plan and was deliberately replaced: it spent most of the build effort re-proving a vendor's already-proven plugin. Traccar Client fires location pings to any URL; a Supabase Edge Function receives them and inserts into `location_logs`, mapping device → active visit. Swapping Traccar for embedded in-app tracking is a contained Phase 2 task against a proven data layer, if single-app UX ever justifies it.
- **The app itself: a plain PWA** (React + TypeScript + Vite). Check-in/check-out, dog label, terrain note, media capture, magic-link auth. **Amended 2026-07-05:** the no-Capacitor rule was about not custom-building GPS, and that reasoning stands — but a **Capacitor wrap of the finished PWA is now committed scope** (ROADMAP Phase 7, closed-track private distribution) once push notifications justify it. All four role experiences are built and proven in the PWA *first*; the wrap is packaging, not a rebuild.
- **Media capture: PWA browser camera capture → Supabase Storage** (two private buckets: `visit-photos`, `visit-video`), each file linked to its visit row. Signed-URL access only.
- **Calendar: read-only ingestion of Steve's Google Calendar via its private ICS feed URL.** No OAuth, no GCP OAuth app, no consent screens in Phase 1. An edge function fetches/parses on a schedule and upserts into `calendar_events`; check-in offers a match against today's events. The secret ICS URL is a credential — it goes in Supabase secrets, never in the repo.
- **Timer/distance are derived, not captured:** duration from check-in/out timestamps; distance via PostGIS over the visit's point stream.
- **Database:** new Supabase project, Postgres + **PostGIS extension enabled**. Coordinates stored as both `GEOMETRY(Point, 4326)` and flat `NUMERIC` lat/lng.
- **No backend API server in Phase 1.** PWA talks to Supabase directly (RLS-gated); Traccar and calendar ingestion go through Supabase Edge Functions.
- **RLS is enabled by default** on all tables, written at migration time. See `context/DATA_MODEL.sql`.
- **`walker_id` is a real foreign key to `auth.users(id)`.**
- **Auth:** Supabase magic-link. Friction accepted.
- **No cloud dev box.** Claude Code runs locally against this repo as sole builder; Gemini CLI reviews PRs locally (the Gemini Code Assist GitHub app was rejected: consumer version sunsets 2026-07-17, enterprise version requires descoped GCP infrastructure).

Full schema: `context/DATA_MODEL.sql`. Full QA/acceptance criteria: `context/QA_TEST_PLAN.md`.

## Requirements vs. implementation — how disagreement gets handled

Distinguish between the two. A **requirement** ("must survive a locked screen for 45 minutes with no gap over 60 seconds") is not up for agent-level debate — if Claude Code and Gemini CLI disagree on a requirement, that's a genuine conflict and belongs in a GitHub Issue for Steve, not a decision either agent makes unilaterally. An **implementation choice** ("which specific location plugin API call") can differ between the two agents' approaches without it being a problem — ship both as separate PRs if they diverge meaningfully, let the working code settle it.

## Workflow

- `main` is protected. All changes go through a PR. Claude Code builds; Gemini CLI (run locally by Steve with the code-review extension) reviews every PR; Steve arbitrates and merges.
- GitHub Issues are the source of truth for open questions and requirements — not chat, not a doc that isn't in this repo.
- See `.github/pull_request_template.md` and `.github/ISSUE_TEMPLATE/requirement.yml`.

## Phase 2 (reference only — do not build yet)

Real backend (Cloud Run) once there's server-side logic to centralize; Clients/Dogs/Appointments/Incidents tables; photo/video via Supabase Storage; Open-Meteo weather enrichment; the existing n8n (Hostinger KVM2) → Claude API care-report pipeline; full admin/walker UI in the Outside Feet brand system (Moss Trail #226346, Oat Cream #FFF2CD, Trail Marker #FB7939, Wildflower #FAFF6E; Poppins/DM Sans/Mairo); iOS support (Traccar Client also ships an iOS app, so the same architecture extends; embedded in-app tracking via a native wrapper remains the fallback if single-app UX is ever required).
