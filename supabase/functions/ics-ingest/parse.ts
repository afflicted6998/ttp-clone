// Pure ICS → calendar_events rows conversion. Uses Mozilla's ical.js (the
// parser behind Thunderbird) because recurring events are the classic
// hand-rolled-parser failure — QA_TEST_PLAN.md calls this out explicitly.
//
// Runs under both runtimes: Deno resolves "ical.js" via this folder's
// deno.json import map; Node (local tests) via the root package.json.

import ICAL from "ical.js";

export interface CalendarRow {
  ics_uid: string;
  title: string | null;
  description: string | null;
  location: string | null;
  starts_at: string; // ISO
  ends_at: string;   // ISO
  raw_ics: string;
}

/**
 * Parse an ICS feed and return one row per event *occurrence* overlapping
 * [windowStart, windowEnd].
 *
 * Recurring events share one UID across all their occurrences, but
 * calendar_events.ics_uid is UNIQUE — so recurring instances get a composite
 * uid "<UID>:<RECURRENCE-ID>". The recurrence id is the occurrence's
 * *originally scheduled* time, which stays stable even when a single
 * instance is rescheduled (its RECURRENCE-ID doesn't change), so upserts
 * update the moved instance instead of duplicating it.
 */
export function parseCalendar(
  icsText: string,
  windowStart: Date,
  windowEnd: Date,
): CalendarRow[] {
  const comp = new ICAL.Component(ICAL.parse(icsText));

  // Google feeds carry VTIMEZONE blocks; register them so TZID-relative
  // times convert to correct absolute instants.
  for (const vtz of comp.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vtz);
    if (!ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz.tzid, tz);
  }

  const events = comp
    .getAllSubcomponents("vevent")
    .map((v: any) => new ICAL.Event(v));

  // VEVENTs with a RECURRENCE-ID are single-instance exceptions (a moved or
  // edited occurrence); attach them to their master event so the iterator
  // yields the edited version.
  const masters = events.filter((e: any) => !e.isRecurrenceException());
  for (const ex of events.filter((e: any) => e.isRecurrenceException())) {
    const master = masters.find((m: any) => m.uid === ex.uid);
    if (master) master.relateException(ex);
    // An exception with no master in the feed is dropped; Google always
    // includes the master in the same feed.
  }

  const rows: CalendarRow[] = [];

  for (const event of masters) {
    if (!event.startDate) continue; // defensive: skip malformed VEVENTs
    if (isCancelled(event)) continue; // Google can mark events STATUS:CANCELLED

    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate();
      const end = (event.endDate ?? event.startDate).toJSDate();
      if (end < windowStart || start > windowEnd) continue;
      rows.push(toRow(event.uid, event, start, end));
      continue;
    }

    const iterator = event.iterator();
    let next: any;
    while ((next = iterator.next())) {
      const occ = event.getOccurrenceDetails(next);
      const start = occ.startDate.toJSDate();
      if (start > windowEnd) break; // occurrences come in order; done
      const end = occ.endDate.toJSDate();
      if (end < windowStart) continue;
      // occ.item is the exception event when this instance was edited,
      // otherwise the master — titles/notes of edited instances win.
      // Google cancels single instances either via EXDATE (never reaches
      // here) or via a STATUS:CANCELLED exception (skipped here).
      if (isCancelled(occ.item)) continue;
      rows.push(
        toRow(`${event.uid}:${occ.recurrenceId.toString()}`, occ.item, start, end),
      );
    }
  }

  return rows;
}

function isCancelled(event: any): boolean {
  return String(event.component.getFirstPropertyValue("status") ?? "")
    .toUpperCase() === "CANCELLED";
}

function toRow(icsUid: string, event: any, start: Date, end: Date): CalendarRow {
  return {
    ics_uid: icsUid,
    title: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    raw_ics: event.component.toString(),
  };
}
