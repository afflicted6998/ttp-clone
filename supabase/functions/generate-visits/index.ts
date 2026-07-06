// Visit generation from schedule templates — Supabase Edge Function.
// Phase 5 PREP: manually triggered from the admin Schedules tab. There is
// deliberately NO cron here — turning generation on as an automatic feed
// (and retiring Google Calendar) is the Phase 5 activation gate, Steve's
// call, not a side effect of deploying a function (ROADMAP ruling 3).
//
// POST { days?, schedule_id?, dry_run? } with an admin JWT.
// Expands each active schedule [now, now+days) via the tested recurrence
// engine, applies exceptions, and inserts ONLY missing visits — the partial
// unique index on (schedule_id, scheduled_start) makes double generation
// impossible even under racing runs (upsert ignoreDuplicates backstops it).
//
// Generated visits: status 'scheduled', walker_id NULL (nobody has walked
// yet — the v2_review_fixes migration exists for exactly this row shape),
// assigned_staff_id from the schedule's default, dog_label + visit_dogs
// from schedule_dogs.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  diffOccurrences,
  expandSchedule,
  type ExceptionSpec,
} from "../_shared/recurrence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const started = Date.now();
  if (req.method !== "POST") return json(405, { error: "POST only" });

  let days = 14;
  let scheduleId: string | null = null;
  let dryRun = false;
  try {
    const body = await req.json();
    if (body.days !== undefined) days = Number(body.days);
    if (body.schedule_id) scheduleId = String(body.schedule_id);
    dryRun = body.dry_run === true;
  } catch {
    /* empty body = defaults */
  }
  if (!Number.isFinite(days) || days < 1 || days > 60) {
    return json(400, { error: "days must be 1–60" });
  }

  // Generation is an admin action. app_is_admin() runs as the CALLER via
  // PostgREST rpc — verify_jwt already guaranteed a valid JWT.
  const caller = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
  });
  const { data: isAdmin, error: adminErr } = await caller.rpc("app_is_admin");
  if (adminErr) return json(500, { error: `admin check: ${adminErr.message}` });
  if (isAdmin !== true) return json(403, { error: "admins only" });

  let schedulesQuery = service
    .from("schedules")
    .select("id, client_id, label, rrule, dtstart_local, timezone, duration_minutes, default_staff_id")
    .eq("active", true);
  if (scheduleId) schedulesQuery = schedulesQuery.eq("id", scheduleId);
  const { data: schedules, error: schedErr } = await schedulesQuery;
  if (schedErr) return json(500, { error: `schedules: ${schedErr.message}` });

  const windowStart = new Date();
  const windowEnd = new Date(Date.now() + days * 86400_000);
  const results: Record<string, unknown>[] = [];

  for (const s of schedules ?? []) {
    const [exRes, existingRes, dogsRes] = await Promise.all([
      service
        .from("schedule_exceptions")
        .select("original_start_local, kind, moved_to_local")
        .eq("schedule_id", s.id),
      service
        .from("visits")
        .select("scheduled_start")
        .eq("schedule_id", s.id)
        .not("scheduled_start", "is", null),
      service.from("schedule_dogs").select("dog_id, dogs(name)").eq("schedule_id", s.id),
    ]);
    if (exRes.error || existingRes.error || dogsRes.error) {
      results.push({ schedule: s.id, error: (exRes.error ?? existingRes.error ?? dogsRes.error)!.message });
      continue;
    }

    const exceptions: ExceptionSpec[] = (exRes.data ?? []).map((e) => ({
      originalStartLocal: e.original_start_local,
      kind: e.kind as "skip" | "moved",
      movedToLocal: e.moved_to_local,
    }));

    let occurrences;
    try {
      occurrences = expandSchedule(
        {
          rrule: s.rrule,
          dtstartLocal: s.dtstart_local,
          timezone: s.timezone,
          durationMinutes: s.duration_minutes,
        },
        exceptions,
        windowStart,
        windowEnd,
      );
    } catch (e) {
      results.push({ schedule: s.id, error: `expand: ${(e as Error).message}` });
      continue;
    }

    const missing = diffOccurrences(
      occurrences,
      (existingRes.data ?? []).map((v) => v.scheduled_start as string),
    );

    const dogIds = (dogsRes.data ?? []).map((d) => d.dog_id as string);
    const dogNames = (dogsRes.data ?? [])
      .map((d) => (d.dogs as unknown as { name: string } | null)?.name)
      .filter((x): x is string => Boolean(x));
    const label = dogNames.length > 0 ? dogNames.join(" and ") : s.label;

    if (dryRun) {
      results.push({ schedule: s.id, label, would_create: missing.length });
      continue;
    }

    let created = 0;
    if (missing.length > 0) {
      const { data: inserted, error: insErr } = await service
        .from("visits")
        .upsert(
          missing.map((o) => ({
            schedule_id: s.id,
            scheduled_start: o.startUtc,
            client_id: s.client_id,
            assigned_staff_id: s.default_staff_id,
            dog_label: label,
            status: "scheduled",
            source: "schedule",
          })),
          { onConflict: "schedule_id,scheduled_start", ignoreDuplicates: true },
        )
        .select("id");
      if (insErr) {
        results.push({ schedule: s.id, error: `insert: ${insErr.message}` });
        continue;
      }
      created = inserted?.length ?? 0;
      if (dogIds.length > 0 && inserted && inserted.length > 0) {
        const junction = inserted.flatMap((v) => dogIds.map((d) => ({ visit_id: v.id, dog_id: d })));
        const { error: vdErr } = await service
          .from("visit_dogs")
          .upsert(junction, { onConflict: "visit_id,dog_id", ignoreDuplicates: true });
        if (vdErr) console.error(`visit_dogs for schedule ${s.id}: ${vdErr.message}`);
      }
    }
    results.push({ schedule: s.id, label, created, window_occurrences: occurrences.length });
  }

  return json(200, { ok: true, days, dry_run: dryRun, results, elapsed_ms: Date.now() - started });
});
