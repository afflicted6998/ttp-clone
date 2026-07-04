# Handoff — Conversation Context for Claude Code

You are picking up a project that was designed over a long conversation between Steve and Claude (claude.ai). This file carries the decision history that isn't obvious from the specs alone. Read `PROJECT_CONTEXT.md` first for the what; this file is the why and the how-we-got-here.

## Who you're working with

Steve: founder/sole operator of Outside Feet (premium dog walking, DC/Montgomery County MD). Not a professional developer. Directs builds through AI agents and reviews outcomes rather than code line-by-line. Two dogs, Slushy (reactive) and Max — usable as real test subjects for walk testing. His history with ambitious builds: they run long and unproductive when scope creeps or when tooling problems replace the actual goal. Your job includes protecting the scope, not just executing it.

Steve's explicit standing instruction from the design conversation: be tenacious — find the best solution, not the one he first described; make decisions rather than stalling on questions; but surface every decision made on his behalf so he can override it. He has QC review (Gemini CLI on every PR) precisely so that reasonable risk-taking is safe.

## The mission in one sentence

Time to Pet captures Steve's business data and won't give it back (no GPS export, media requires manual workarounds). Phase 1 proves every category of that data can land in Steve-owned infrastructure instead.

## Decision history — do not relitigate these without new information

1. **Started as a full TTP-clone weekend build** (Capacitor + TransistorSoft GPS + Kimi K2.6 agent swarm + GCP build box). Deliberately replaced: it spent most of its effort re-proving a vendor's already-proven GPS plugin.
2. **Gemini (chat) produced four alternative solutions**; only two were ever surfaced for review. That failure — work produced but not surfaced — is why the PR-always workflow exists. Never keep an alternative approach local; open it as a draft PR.
3. **Current architecture (Traccar + PWA + Supabase) replaced Capacitor entirely.** Background GPS is commodity; Traccar Client handles it. The PWA has no native build chain. If you find yourself adding Capacitor, Android Studio, or an APK step, stop — you're rebuilding the thing that was cut.
4. **Kimi K2.6 was dropped** with the architecture that needed parallel UI generation. You are the sole builder. Gemini CLI (run by Steve locally) reviews your PRs.
5. **The Gemini Code Assist GitHub app was considered and rejected** (consumer version sunsets July 17, 2026; enterprise version needs GCP infrastructure that was descoped).
6. **Scope grew once, deliberately**: Steve added media capture, timer/distance, and Google Calendar ingestion to Phase 1 after the descope, because they're core to the data-ownership thesis. That expansion is in PROJECT_CONTEXT.md. Further Phase 1 expansion should be treated as a scope question for Steve, not absorbed silently.
7. **RLS stays on.** It was proposed off-by-default twice for velocity and rejected both times. The friction Steve accepted is UX friction, not database exposure.
8. **Known bugs already caught and fixed in the specs** — don't reintroduce them: FK ordering (calendar_events must be created before visits), `walker_id` must be a real FK to auth.users, Capacitor version pins are irrelevant now but were wrong once.

## How to work

- Branch → PR → Steve reviews (with Gemini CLI findings) → merge. Never push to main; it's protected anyway.
- Small PRs. Steve reads outcomes, not diffs — your PR descriptions carry the explanation load. Write them for a smart non-developer.
- Open a GitHub Issue (template provided) for anything you're inferring rather than reading from `context/`. Genuine requirement disagreements get the "Blocked — needs Steve" status, not a unilateral call.
- The Phase 1 pass condition is `context/QA_TEST_PLAN.md`'s core test: one real walk where GPS, media, timer, distance, and calendar context all land queryable in Supabase, validated against a concurrent TTP session.

## Sensible first PRs, in dependency order

1. Supabase edge function: Traccar receiver (ping → active-visit mapping → `location_logs`), with shared-token auth and a deliberate policy for orphan pings.
2. Supabase edge function: ICS ingestion (scheduled fetch of `ICS_FEED_URL` → upsert `calendar_events`), handling recurring events.
3. PWA scaffold: magic-link auth, check-in/out against today's calendar events, dog label, terrain note.
4. Media capture in the PWA → Storage buckets → `media` rows.
5. Derived fields on checkout: `duration_minutes`, `distance_meters` (PostGIS over the visit's points).
6. A read-only visit detail view: the route on a map, media, timer/distance — enough for Steve to *see* the data-ownership win, which is the emotional payoff of the whole phase.

Everything in `context/` is authoritative over this file if they ever conflict.
