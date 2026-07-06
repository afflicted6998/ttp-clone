// Weekly RRULE builder for the schedules screen. Deliberately ONLY weekly
// BYDAY rules — that's the actual shape of a dog-walking book ("MWF midday").
// The engine accepts any RFC 5545 rule; the moment a non-weekly need shows
// up, the free-text escape hatch in the admin form covers it and this
// builder grows in a reviewed PR, not silently.

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function weeklyRrule(days: Weekday[]): string {
  const ordered = WEEKDAYS.filter((d) => days.includes(d));
  if (ordered.length === 0) throw new Error("weeklyRrule: pick at least one day");
  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

/** Inverse for editing. null = not a plain weekly rule (edit as free text). */
export function parseWeeklyRrule(rrule: string): Weekday[] | null {
  const m = /^FREQ=WEEKLY;BYDAY=([A-Z,]+)$/.exec(rrule.trim());
  if (!m) return null;
  const days = m[1].split(",");
  if (!days.every((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))) return null;
  return days as Weekday[];
}
