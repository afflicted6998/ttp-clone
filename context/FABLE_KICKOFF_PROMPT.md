# Fable Kickoff Prompt — Full Native Replacement (2026-07-05)

**Status:** Supersedes the phasing in `PROJECT_CONTEXT.md` / `HANDOFF.md` / `phase2_interview_handoff.md` wherever they conflict with this file. Those earlier docs assumed low confidence that Phase 1 would even work, and scoped conservatively (PWA-only, iOS deferred, TTP kept running alongside indefinitely, QuickBooks/billing excluded). Phase 1 succeeded. This is the new north star: a full native replacement for Time To Pet, no exclusions, run through Anthropic's Fable 5 optimizer (via the AIBMM Amplifiers "Fable 5 prompt optimizer").

Phase 1's proven pipeline (Traccar GPS ingest, Supabase Storage media capture, server-derived duration/distance triggers, read-only ICS calendar ingest, the Supabase Postgres/PostGIS/RLS pattern) is **not** to be re-tested or rebuilt — treat it as settled infrastructure to extend.

---

## The prompt to run on Fable

```
I'm updating the north star for Outside Feet's software project (a solo, soon-to-grow
dog-walking business in the DC/Montgomery County MD area) again — the scope just got
bigger, and I want you to build for the bigger version from here on.

Background: Phase 1 is already built and proven — a walker-facing PWA (React/TypeScript/
Vite) on Supabase (Postgres + PostGIS, Edge Functions, Storage, Auth) that captures GPS
tracks via Traccar Client, photos/video, server-derived visit duration/distance, and
read-only Google Calendar ingestion. It passed its real-world test against a live Time
To Pet (TTP) session. Treat that pipeline as proven infrastructure to extend — not to
re-validate or rebuild.

Updated goal: nothing is out of scope anymore. I want a full native replacement for Time
To Pet that matches everything TTP does and goes further wherever you see the
opportunity — including billing/invoicing/QuickBooks, which I'd previously told you to
exclude. Don't just replicate TTP's feature list: call out where you can genuinely do
better (fewer steps, better data ownership, capabilities TTP doesn't offer at all), and
build those in.

What "done" looks like:
- Four role-based native mobile apps — Client, Walker, Admin, Owner — each showing only
  what that role needs, all reading/writing the same Supabase backend.
- Android first, fully working end to end for all four roles, before any iOS work starts.
- Walker app = the existing proven functionality (check-in/out, GPS, media capture,
  calendar context), carried into a native shell instead of the PWA.
- Client app = their own pets' visit history, GPS route maps, photos/video, visit
  reports, in-app — plus whatever else TTP does for clients that we haven't nailed down
  yet (messaging, schedule-change requests, invoice/payment status). Surface these as
  options in your plan rather than skipping them just because they weren't spelled out.
- Admin app = staff/walker scheduling, client and pet records, visit assignment,
  business-wide reporting, plus billing/invoicing.
- Owner app = everything Admin sees, plus business-level rollups for running the company
  day to day.
- Real Clients, Dogs/Pets, multi-walker support, and a billing/invoicing data model —
  the current schema assumes one walker and a free-text dog label, which won't hold
  under four roles, hired staff, or money moving through the system.
- QuickBooks: already scoped separately — an n8n automation layer (already running our
  Claude API care-report pipeline) using QuickBooks's native OAuth2 node, or Intuit's
  official MCP server, are both viable low-friction paths. Pick whichever fits the rest
  of the architecture and design the invoicing/billing data flow around it.

Design within these constraints rather than treating them as steps to follow in order:
preserve and extend the existing Supabase schema/RLS pattern rather than replacing it,
and don't touch or re-test the Traccar GPS ingestion, media upload, or duration/distance
derivation logic — build on top of it as-is.

Token/model-routing requirement — treat this as equal in importance to the technical
plan: this project runs across multiple models at different costs (you at high effort,
Sonnet 5, and Gemini/ChatGPT for lighter coding work), and Fable-level tokens shouldn't
go toward work a cheaper model handles just as well. As part of your plan, produce an
explicit routing table: for each major category of work (data model/schema design,
novel architecture decisions, role/permissions design, a given app's UI screens, CRUD
boilerplate, test writing, documentation, QuickBooks field mapping, etc.), state which
engine should own it — you at high/max effort, you at a lower effort setting, Sonnet 5,
or Gemini/ChatGPT — and a one-line reason why. Default ambiguous or judgment-heavy work
to yourself; default repetitive, well-specified, or low-stakes work downward.

Before handing back a plan, check it against everything above — the four apps, the
schema changes, the QuickBooks integration, and the routing table — and flag anything
you had to guess at or any judgment call you made on my behalf, so I can correct it if
it's wrong.
```

---

## What changed across the optimizer passes

- **v1 → v2:** Reversed the QuickBooks/billing exclusion into an explicit inclusion, and pre-loaded the two integration paths researched live (n8n's native QuickBooks OAuth2 node — 37 actions/10 resource types; Intuit's official `quickbooks-online-mcp-server` — 144 tools/29 entities) so Fable isn't starting that decision cold.
- Turned "give me everything TTP has, and more" into a checkable condition ("call out where you can do better") instead of an unverifiable ambition.
- Converted the token-efficiency concern into a required deliverable — a routing table mapping work categories to Fable (high/low effort) / Sonnet 5 / Gemini-ChatGPT with a stated reason — rather than a vague "be frugal" reminder.
- Kept the outcome-first structure throughout: no prescriptive step-by-step sequence, context on *why* (Steve's history with vibe-coding frustration, the original conservative scoping, why it's changing now), and a closing self-verification instruction so Fable flags its own assumptions instead of silently guessing.

## Effort guidance

Run on **High**, not Max. This is a planning/architecture task (produce a plan + routing table), not one requiring deep simultaneous reasoning over conflicting constraints — the tier where High is the sweet spot. The prompt's built-in self-verification step ("flag anything you guessed at") covers a lot of what Max's extra deliberation would otherwise buy. If the resulting plan is shallow or dodges the QuickBooks/routing-table asks, escalate *that specific follow-up* to Max rather than the whole prompt.
