// Display formatting for the derived fields. Pure, unit-tested.

export function formatDistance(meters: number | null): string {
  if (meters === null || !Number.isFinite(meters)) return "—";
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}
