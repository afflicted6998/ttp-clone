import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { formatDistance } from "../format";
import { weeklyRollups, type WeekRollup } from "../rollups";

// Owner rollups (ROADMAP Phase 3: "basic owner rollups (walks/week,
// revenue-ready counts)"). Owner-only by ruling 1: Owner = Admin + rollups.
// Aggregated client-side over the last 8 weeks of completed visits — at
// solo-operator volume that is dozens of rows, not thousands; a SQL rollup
// view is Phase 8's problem.
export function RollupsAdmin() {
  const [weeks, setWeeks] = useState<WeekRollup[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const since = new Date(Date.now() - 8 * 7 * 86400_000).toISOString();
    supabase
      .from("visits")
      .select("check_in_time, duration_minutes, distance_meters")
      .eq("status", "completed")
      .gte("check_in_time", since)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else {
          setWeeks(
            weeklyRollups(
              (data ?? [])
                .filter((v) => v.check_in_time !== null)
                .map((v) => ({
                  check_in_time: v.check_in_time as string,
                  duration_minutes: v.duration_minutes === null ? null : Number(v.duration_minutes),
                  distance_meters: v.distance_meters === null ? null : Number(v.distance_meters),
                })),
            ),
          );
        }
      });
  }, []);

  return (
    <div className="card">
      <h3>Weekly rollups — last 8 weeks</h3>
      {error && <p className="error">{error}</p>}
      {weeks.map((w) => (
        <p key={w.weekStart}>
          <strong>Week of {w.weekStart}</strong>
          <br />
          <span className="muted">
            {w.walks} walk{w.walks === 1 ? "" : "s"} · {Math.round(w.totalMinutes)} min total ·{" "}
            {formatDistance(w.totalMeters)}
          </span>
        </p>
      ))}
      {weeks.length === 0 && !error && <p className="muted">No completed walks in the window.</p>}
    </div>
  );
}
