# TTP Clone

Phase 1 of a self-owned data layer for Outside Feet, motivated by Time to Pet's refusal to hand over its own data. Current goal: prove that GPS tracks, photos/video, visit timer/distance, and appointment context all land in Steve-owned infrastructure from one real walk on a physical Pixel 9 Pro — validated against a live Time to Pet session as ground truth. Architecture: Traccar Client (background GPS) + a plain PWA + Supabase.

- **Project context for humans and agents:** [`context/PROJECT_CONTEXT.md`](context/PROJECT_CONTEXT.md)
- **Data model:** [`context/DATA_MODEL.sql`](context/DATA_MODEL.sql)
- **QA / acceptance criteria:** [`context/QA_TEST_PLAN.md`](context/QA_TEST_PLAN.md)
- **Agent instructions:** [`CLAUDE.md`](CLAUDE.md) / [`GEMINI.md`](GEMINI.md)

`main` is protected. All changes go through a PR. Open questions and requirement disagreements live as GitHub Issues, not chat — see the issue template.
