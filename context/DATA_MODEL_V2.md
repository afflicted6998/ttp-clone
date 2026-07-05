# Data Model v2 — Guide

**Canonical SQL lives in the migrations** (`20260706000000_phase2_visit_fields.sql`,
`20260706001000_schema_v2_core.sql`) — unlike Phase 1, the SQL is not duplicated
here, to prevent doc/migration drift on a schema this size. This file is the map,
the rationale, and the deferred-messaging appendix.

## Table map

```
staff ──────────────┐              clients ────────────┐
  (walker/admin/     │                │                 │
   owner roles)      │                ├─ dogs           ├─ invoices ─ invoice_lines ─(visit)
                     │                │                 └─ schedule_change_requests
                     ▼                ▼
              visits (Phase 1) ← client_id, assigned_staff_id, schedule_id,
                │                scheduled_start, source, pee/poop counts
                ├─ visit_dogs ─ dogs
                ├─ location_logs (Phase 1, untouched)
                └─ media (Phase 1, untouched)

              schedules ─ schedule_dogs ─ dogs
                └─ schedule_exceptions        calendar_events (Phase 1; policy tightened)
```

## Who sees what (the four-role RLS contract)

| | Walker | Admin | Owner | Client |
|---|---|---|---|---|
| Own staff row | ✓ | all staff | all staff | — |
| Clients & dogs | only clients they serve | all | all | own record + own dogs |
| Visits / GPS / media | own + assigned | all | all | read own visits' data |
| Schedules | ones assigned to them | manage all | manage all | read own |
| Change requests | — | decide | decide | create + read own |
| Invoices | **no access** | manage | manage | read own |
| Business calendar | ✓ | ✓ | ✓ | **no** (fixed in v2 — was any-authenticated) |

Owner ⊇ Admin by construction (`role IN ('admin','owner')` everywhere).
Phase-1 policies stay in place; v2 policies are additive — **the live PWA keeps
working unchanged the moment this applies.**

## Decisions embedded here (see ROADMAP.md decision log)

- **Integer cents** for all money. **RRULE + wall-clock-time + timezone** for
  recurrence (10 AM stays 10 AM across DST). **Counts not booleans** for pee/poop.
- **`visit_dogs` junction**: Samson + Reba on one walk is the norm. `dog_label`
  becomes legacy display text until Phase 3 CRM screens exist.
- **`clients.home_access_notes`** restores the key/lockbox field that fell out of
  scope in the original descope — it's back, and RLS-guarded.
- **`visits.assigned_staff_id` vs `walker_id`**: who is *supposed* to do the visit
  vs. who *did* it. Legacy rows keep `walker_id` only.
- **Unique `(schedule_id, scheduled_start)`** makes engine visit-generation
  idempotent — re-running generation can never duplicate a visit.
- **Seed**: existing Phase-1 walker auth users become `owner` staff automatically.
- Known accepted gap: an admin could edit the owner's staff row (no demotion
  guard). Fine while the only admin is Steve; add a trigger guard before hiring one.

## Applying

Phase-2 fields migration is safe to apply immediately (it's three columns).
The v2 core migration should apply **after Gemini review** — it contains the
calendar_events policy swap and the whole RLS surface. Apply via `supabase db push`
(history was reconciled 2026-07-05) or MCP with migration-history insert.

## Appendix: messaging tables (Phase 7 — designed, deliberately NOT migrated)

```sql
CREATE TABLE public.message_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ
);

CREATE TABLE public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.message_threads(id) ON DELETE CASCADE,
    sender_kind TEXT NOT NULL CHECK (sender_kind IN ('client', 'staff')),
    sender_id UUID NOT NULL,            -- clients.id or staff.id per sender_kind
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- RLS sketch: client reads/writes own threads (client_id = app_client_id());
-- staff read all, write as staff. Realtime subscription on messages for live
-- chat; push notification fan-out is the Phase 7 wrap trigger.
```
