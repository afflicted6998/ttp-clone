// Weekly rollups from completed visits — pure aggregation, tested. Weeks
// start Monday (dog-walking businesses think in work weeks), keyed by the
// check-in date in local time.

export interface CompletedVisit {
  check_in_time: string; // ISO
  duration_minutes: number | null;
  distance_meters: number | null;
}

export interface WeekRollup {
  weekStart: string; // YYYY-MM-DD (Monday)
  walks: number;
  totalMinutes: number;
  totalMeters: number;
}

/** Monday of the week containing d, in local time, as YYYY-MM-DD. */
export function mondayOf(d: Date): string {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (local.getDay() + 6) % 7; // Mon=0 … Sun=6
  local.setDate(local.getDate() - dow);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Group completed visits into per-week totals, newest week first. */
export function weeklyRollups(visits: CompletedVisit[]): WeekRollup[] {
  const byWeek = new Map<string, WeekRollup>();
  for (const v of visits) {
    const week = mondayOf(new Date(v.check_in_time));
    const r = byWeek.get(week) ?? { weekStart: week, walks: 0, totalMinutes: 0, totalMeters: 0 };
    r.walks += 1;
    r.totalMinutes += v.duration_minutes ?? 0;
    r.totalMeters += v.distance_meters ?? 0;
    byWeek.set(week, r);
  }
  return [...byWeek.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
}
