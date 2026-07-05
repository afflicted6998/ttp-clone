// Recurrence engine core — foundation sprint deliverable 3 of 3 (ROADMAP S0).
//
// Pure logic, no Deno/Supabase imports: unit-testable with tsx (like ping.ts /
// parse.ts, the pattern that survived four review rounds). Consumed at Phase 5
// activation by a visit-generation edge function and by Admin-app previews.
//
// Semantics (ROADMAP decision log):
//  * A schedule is an RFC 5545 RRULE + a WALL-CLOCK start ("2026-07-06T10:00:00")
//    + an IANA timezone. Wall time is authoritative: a 10:00 walk is 10:00
//    year-round; the UTC instant shifts at DST boundaries, never the wall time.
//    We reuse ical.js for expansion — the same proven dependency as the ICS
//    ingester. We do NOT invent recurrence semantics.
//  * Exceptions are keyed by the occurrence's original wall-clock start:
//    'skip' removes it; 'moved' relocates it (possibly across the window edge).
//  * Output occurrences carry UTC instants (for visits.scheduled_start) plus
//    the original wall-clock key (for exception round-tripping).

import ICAL from "ical.js";

export interface ScheduleSpec {
  rrule: string;              // e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  dtstartLocal: string;       // wall clock, "2026-07-06T10:00:00" (space-separated accepted)
  timezone: string;           // IANA id; must be in TZ_DATA below
  durationMinutes: number;
}

export interface ExceptionSpec {
  originalStartLocal: string;         // wall-clock key of the affected occurrence
  kind: "skip" | "moved";
  movedToLocal?: string | null;       // wall clock, required for 'moved'
}

export interface Occurrence {
  originalStartLocal: string;  // exception key, wall clock
  startUtc: string;            // ISO — what visits.scheduled_start stores
  endUtc: string;              // ISO
  moved: boolean;
}

// VTIMEZONE definitions for supported zones. The business operates in US
// Eastern; add zones here (with their VTIMEZONE blocks) if that ever changes.
// Sourced from the same rules Google feeds carry (see ics-ingest tests).
const TZ_DATA: Record<string, string> = {
  "America/New_York": [
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n"),
};

// How far past the window edges we expand before applying 'moved' exceptions,
// so an occurrence moved INTO the window from outside it is still found.
const MOVE_HORIZON_MS = 31 * 24 * 60 * 60 * 1000;

function normalizeLocal(s: string): string {
  // "2026-07-06 10:00:00.000" (Postgres timestamp) -> "2026-07-06T10:00:00"
  const t = s.trim().replace(" ", "T").replace(/\.\d+$/, "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t)) {
    throw new Error(`unparseable local time: "${s}" (expected YYYY-MM-DDTHH:mm[:ss])`);
  }
  return t.length === 16 ? `${t}:00` : t;
}

function toIcsLocal(s: string): string {
  return normalizeLocal(s).replace(/[-:]/g, "");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function wallClockOf(t: any): string {
  return `${t.year}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

function registerZone(timezone: string): void {
  if (ICAL.TimezoneService.has(timezone)) return;
  const vtz = TZ_DATA[timezone];
  if (!vtz) {
    throw new Error(
      `unsupported timezone "${timezone}" — add its VTIMEZONE block to TZ_DATA in recurrence.ts`,
    );
  }
  const comp = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${vtz}\r\nEND:VCALENDAR`));
  const tzComp = comp.getFirstSubcomponent("vtimezone");
  ICAL.TimezoneService.register(timezone, new ICAL.Timezone(tzComp));
}

/** Wall-clock string in a zone → UTC Date. */
export function localToUtc(localStr: string, timezone: string): Date {
  registerZone(timezone);
  const t = ICAL.Time.fromDateTimeString(normalizeLocal(localStr));
  t.zone = ICAL.TimezoneService.get(timezone);
  return new Date(t.toUnixTime() * 1000);
}

/**
 * Expand a schedule into concrete occurrences whose FINAL start (after 'moved'
 * exceptions) falls in [windowStartUtc, windowEndUtc). Skips removed; moves
 * honored across window edges (±31 days).
 */
export function expandSchedule(
  spec: ScheduleSpec,
  exceptions: ExceptionSpec[],
  windowStartUtc: Date,
  windowEndUtc: Date,
): Occurrence[] {
  registerZone(spec.timezone);
  if (!Number.isFinite(spec.durationMinutes) || spec.durationMinutes <= 0) {
    throw new Error(`invalid durationMinutes: ${spec.durationMinutes}`);
  }

  const byOriginal = new Map<string, ExceptionSpec>();
  for (const ex of exceptions) {
    const key = normalizeLocal(ex.originalStartLocal);
    if (ex.kind === "moved" && !ex.movedToLocal) {
      throw new Error(`moved exception at ${key} lacks movedToLocal`);
    }
    byOriginal.set(key, ex);
  }

  const ics = [
    "BEGIN:VCALENDAR",
    TZ_DATA[spec.timezone] ?? "",
    "BEGIN:VEVENT",
    "UID:schedule@outsidefeet",
    `DTSTART;TZID=${spec.timezone}:${toIcsLocal(spec.dtstartLocal)}`,
    `RRULE:${spec.rrule}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  const comp = new ICAL.Component(ICAL.parse(ics));
  for (const vtz of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vtz);
    if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz.tzid, tz);
  }
  const event = new ICAL.Event(comp.getFirstSubcomponent("vevent"));

  const iterateUntil = windowEndUtc.getTime() + MOVE_HORIZON_MS;
  const durationMs = spec.durationMinutes * 60 * 1000;
  const out: Occurrence[] = [];

  const iterator = event.iterator();
  let next: any;
  while ((next = iterator.next())) {
    const originalUtc = next.toJSDate();
    if (originalUtc.getTime() > iterateUntil) break;

    const originalLocal = wallClockOf(next);
    const ex = byOriginal.get(originalLocal);
    if (ex?.kind === "skip") continue;

    const startUtc =
      ex?.kind === "moved" ? localToUtc(ex.movedToLocal!, spec.timezone) : originalUtc;
    if (startUtc.getTime() < windowStartUtc.getTime()) continue;
    if (startUtc.getTime() >= windowEndUtc.getTime()) continue;

    out.push({
      originalStartLocal: originalLocal,
      startUtc: startUtc.toISOString(),
      endUtc: new Date(startUtc.getTime() + durationMs).toISOString(),
      moved: ex?.kind === "moved",
    });
  }

  out.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return out;
}

/**
 * Which occurrences still need visit rows? Compares against existing generated
 * visits by exact scheduled_start instant. The DB's unique
 * (schedule_id, scheduled_start) index backstops this — double generation is
 * impossible even if two runs race.
 */
export function diffOccurrences(
  occurrences: Occurrence[],
  existingScheduledStartsUtc: string[],
): Occurrence[] {
  const have = new Set(
    existingScheduledStartsUtc.map((s) => new Date(s).toISOString()),
  );
  return occurrences.filter((o) => !have.has(o.startUtc));
}
