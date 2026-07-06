# Roadmap — Full Time To Pet Replacement (North Star v2)

**Status:** Authoritative plan as of 2026-07-05. Encodes Steve's rulings from the
north-star-v2 conflicts session. Supersedes the phasing in PROJECT_CONTEXT.md and
`FABLE_KICKOFF_PROMPT.md` where they differ. Changes to this file go through PRs
Steve merges, like everything else.

## Current Status (2026-07-05)

**Last Action:** 
- Gemini reviewed PRs #17, #18, and #19 and identified critical data-integrity and RLS bugs.
- Built the local `ttp-tracker` dashboard to monitor these documents.

**Next Actions:** 
- **Claude Code (Active)**: Fix the `walker_id` constraint and `staff` RLS visibility rules (see PR Review Findings). This is a hard blocker. Once fixed, begin **Phase 2 (Report cards)**.
- **Gemini (Blocked)**: *Waiting on Claude Code.* Will review the bug-fix PR once submitted.
- **Steve (Blocked)**: *Waiting on Claude Code.* Will merge the bug-fix PR once Gemini approves. *(Optional concurrent task: prepare Open-Meteo API keys or n8n environment for Phase 2).*

## The north star, in one paragraph

A full replacement for Time To Pet: Steve cancels the TTP subscription, owns every
byte his business generates, and neither clients nor walkers are inconvenienced in
the transition. Not all-in-one — an **owned core** (this repo + Supabase) composed
with **external satellites** where buying beats building (QuickBooks for money
movement, closed-track Play distribution, possibly self-hosted Cal.com for booking).
Beyond parity, the system should do things TTP can't: AI-generated care reports,
per-dog behavior/route analytics over owned GPS and visit history, business rollups —
all possible only because the data layer is ours. **This is a private system for
Outside Feet and its customers — never a public app.**

## Binding rulings (2026-07-05)

1. **Two installable apps, four roles.** A **Client app** and a **Team app**
   (Walker / Admin / Owner as permission levels). Owner = Admin + business rollups.
2. **PWA first, wrapper committed.** All four role experiences ship in the proven
   PWA. The **Capacitor wrap is in scope** — it is the destination, not an option —
   triggered when push notifications become a real feature (report cards → messaging).
   Distribution: **Google Play closed track** (invite-only, unlisted, ~$25 one-time),
   never the public store. Client app wraps too (clients live in apps, not email),
   as a late phase gated on real-client testing and budget.
3. **Scheduling, split three ways.** Visit assignment (in-house, Admin phase) ·
   schedule-change requests + approvals (in-house, Client-app phase) · the
   recurrence engine — core built during the 2026-07 discount sprint as pure tested
   code, **activated** later; Google Calendar ingestion carries live scheduling until
   then. Build-vs-self-hosted-Cal.com for client-facing *booking* decided at
   activation with usage data.
4. **Billing: own the data, never move the money.** Invoices and payment status live
   in our Supabase; n8n (existing layer) syncs them to **QuickBooks via its OAuth2
   node** (Intuit's MCP server is for agent/dev access, not the production sync).
   Clients pay through the QuickBooks invoice's own payment link. **No card
   processing is ever built or hosted here** — zero PCI scope.
5. **iOS deferred** until Android is complete end-to-end for all roles; company
   Android devices for hired walkers meanwhile.
6. **Phase 1 pipeline is settled infrastructure.** Traccar ingest, media capture,
   duration/distance triggers, ICS ingestion: extend, don't rebuild or re-test.

## Phases

Order optimizes for earliest client-visible value while the foundation lands in the
discounted window. Each phase has a hard gate, Phase-1 style; a phase isn't done
until its gate test passes on the real device(s).

| # | Phase | Contents | Gate (pass condition) |
|---|---|---|---|
| S0 | **Foundation sprint** (now, discounted) | This plan · schema v2 (clients, dogs, staff, assignment, schedules, invoicing, RLS for 4 roles) · recurrence engine core, pure + tested | Migrations reviewed & applied; engine test suite green; nothing user-visible changes |
| 2 | **Report cards** (scope locked pre-sprint) | Pee/poop counters in walk screen · report email on checkout (photos embedded, video links, stats, map) to test inbox · Open-Meteo weather · n8n → Claude care-report text | One real walk produces a client-ready report email ≤ 60s after checkout |
| 3 | **Team app: Admin + Owner views** | Role-gated PWA views · client & dog CRM screens · visit assignment · visit oversight · basic owner rollups (walks/week, revenue-ready counts) | Steve runs a week of real operations (create client, assign visit, walker completes it) without touching Supabase dashboard |
| 4 | **Billing** | Invoice generation from completed visits · n8n → QuickBooks sync · payment-status readback | A real visit becomes a QB invoice; payment status lands back in our DB without manual entry |
| 5 | **Scheduling activation** | Recurrence engine wired to UI · schedule templates per client · generated visits replace calendar ingestion · booking build-vs-Cal.com decision | A recurring schedule generates two weeks of correct visits incl. a skip + a move; Google Calendar retired for scheduling |
| 6 | **Client app (PWA)** | Client login · their dogs, visit history, reports in-app, media, payment status · schedule-change requests | 2–3 real clients use it for two weeks; feedback logged as issues |
| 7 | **Messaging + push + wrap** | In-app client↔business threads · push notifications · Capacitor wrap of both apps · closed-track distribution | Message + report-card push arrive on a real client's phone from the closed track |
| 8 | **AI analysis layer** | Per-dog trends (routes, pace, pee/poop patterns), business rollups, anything TTP can't do | First insight Steve actually uses in operations |
| — | **TTP cancellation gate** | Checklist below | Steve cancels the subscription |

**TTP cancellation checklist** (all must be true): report cards reaching real
clients · scheduling fully off TTP/Google Calendar · invoicing flowing to QuickBooks ·
messaging live · client onboarding path exists (even if manual-assisted) · 30 days of
parallel running with zero data loss.

**Still external / not built, permanently unless re-ruled:** card processing (QB
links), e-signatures, payroll. **Client onboarding forms**: revisit at Phase 6
(likely a simple in-app form; e-sign stays external).

## Model routing table

Per the kickoff: Fable tokens only where judgment is irreplaceable. Steve relays
work orders to flat-rate Gemini/ChatGPT accounts ("subcontractors"); Gemini CLI
still reviews every PR regardless of author.

| Work category | Engine | Why |
|---|---|---|
| Schema / data model / migrations | **Fable (max)** | Wrong here poisons everything downstream; cross-cutting judgment |
| RLS & role-permission design | **Fable (max)** | Security boundary; a leak = client data exposure |
| Recurrence engine core + edge cases | **Fable (high)** | DST/exception logic is bug bait; needs adversarial thinking |
| Novel architecture & phase-gating decisions | **Fable (high)** | Judgment + full project context |
| Live DB surgery, cross-system debugging | **Fable (high)** | Has Supabase access + judgment; proven in the 07-05 field debug |
| Money-adjacent logic design (invoice gen, QB flow) | **Fable (high)**, mapping grunt-work delegated | Correctness stakes; cents-level bugs are trust-killers |
| Edge functions on proven patterns | **Fable (low)** or Sonnet 5 | Pattern exists (receiver, ICS); mostly careful assembly |
| PWA screens from a written spec | **Subcontractor** (ChatGPT/Gemini) | Well-specified, low-stakes, fully reviewable |
| CRUD forms, list views, boilerplate | **Subcontractor** | Repetitive; spec + review is enough |
| Test writing for specified pure functions | **Sonnet 5** | Cheap, good at coverage; Fable reviews assertions |
| QuickBooks field mapping tables | **Subcontractor draft → Fable review** | Tedious lookup work; review catches unit/date traps |
| Documentation, READMEs, guides | **Subcontractor draft → Fable pass** | Low stakes; Fable ensures accuracy of claims |
| Code review of every PR | **Gemini CLI** (existing role) | Independent eyes; catches what the author can't |
| Small bugfixes in established code | **Sonnet 5** | Context is local; escalate to Fable only if it resists |

**Work-order protocol:** delegated tasks are written as self-contained markdown
files in `work-orders/` — task, files to touch, constraints (RLS invariants, no
new deps without approval), and acceptance criteria a non-author can check
(`npm test` passes, screen X behaves like Y). Steve copy-pastes them out and the
result comes back as a branch/PR. Zero project context assumed on the
subcontractor's side; Steve is a courier, not a translator. Automating the relay
via n8n is possible later but needs metered API keys — manual first.

## Decision log (flagged judgment calls — override any of these by issue/PR)

- Money stored as **integer cents**, never floating point.
- Recurrence expressed as **RFC 5545 RRULE strings** (the iCalendar standard),
  expanded with the already-proven ical.js — we do not invent recurrence semantics.
- Schedule times stored as **wall-clock time + timezone** ("10:00 America/New_York"),
  not UTC instants — so a 10 AM walk stays 10 AM across DST changes.
- Multi-dog visits via a **visit_dogs junction** (Samson + Reba on one walk is the
  norm, not the exception); `dog_label` kept as legacy fallback.
- Pee/poop captured as **counts, not booleans** (better data for Phase 8 analytics;
  UI can still render as toggles).
- Walkers see **only clients they're assigned to** (least privilege); admins see all.
- Messaging tables **designed in v2, migrated at Phase 7** — no dead tables in prod.
- The Phase-2 report email's **60-second delivery bar** (an optimizer-invented
  number Steve accepted) is the acceptance test.

## Pending Strategic Decisions (For Steve)

*(Instruction for Claude Code: If you encounter a strategic decision, UI/UX choice, business logic question, or third-party account requirement that Steve needs to resolve in a later phase, do not make assumptions. Document it in this table so Steve can review and decide when the time comes.)*

| Phase | Decision / Requirement | Context | Status |
|---|---|---|---|
| 2 | **Report Card Aesthetics** | What exactly should the report email look like? Should there be a web-hosted version or just the email body? | Deferred |
| 3 | **Brand & UI/UX Design** | Core branding (colors, logo, typography) and layout structure (sidebar vs bottom nav) for the PWA. | Deferred |
| 4 | **QuickBooks Developer Setup** | Need to create an Intuit Developer account and generate production OAuth2 credentials for the n8n sync. | Deferred |
| 5 | **Booking: Build vs. Cal.com** | Whether to build a custom client booking UI in the PWA or self-host Cal.com for client schedule requests. | Deferred |
| 6 | **Client Onboarding Flow** | Will new clients use a simple in-app form, or will you continue manual-assisted onboarding? E-signatures (for contracts) stay external for now, but need a workflow. | Deferred |
| 7 | **Google Play Developer Account** | Need to create the Google Play Console account ($25 fee) to distribute the Capacitor wrapper in the closed-track. | Deferred |
| 7 | **Push Notification Provider** | Need to decide on the infrastructure for push notifications (e.g., Firebase Cloud Messaging) when wrapping the app. | Deferred |
| 7 | **Staff Contact Privacy** | RLS policy exposes full staff rows (email/phone) to clients they serve. If team size increases, restrict this to public profiles. | Deferred (Return later when team grows) |

