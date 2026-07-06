import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { formatDistance, formatDuration } from "../format";

interface StaffOption {
  id: string;
  full_name: string;
  active: boolean;
}

interface VisitRow {
  id: string;
  dog_label: string | null;
  status: string;
  check_in_time: string | null;
  scheduled_start: string | null;
  duration_minutes: number | null;
  distance_meters: number | null;
  assigned_staff_id: string | null;
  report_sent_at: string | null;
}

// Visit oversight + assignment (ROADMAP Phase 3: "visit assignment · visit
// oversight"). Admin-only via RLS "visits admin all"; assignment writes
// assigned_staff_id (who is SUPPOSED to do it — walker_id stays "who did").
// With a staff of one this assigns everything to Steve, but it exercises the
// exact flow hiring will need, which is the point of building it now.
export function VisitsAdmin() {
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86400_000).toISOString();
    const [visitsRes, staffRes] = await Promise.all([
      supabase
        .from("visits")
        .select(
          "id, dog_label, status, check_in_time, scheduled_start, duration_minutes, distance_meters, assigned_staff_id, report_sent_at",
        )
        .or(`check_in_time.gte.${twoWeeksAgo},scheduled_start.gte.${twoWeeksAgo}`)
        .order("check_in_time", { ascending: false, nullsFirst: true })
        .limit(50),
      supabase.from("staff").select("id, full_name, active").order("full_name"),
    ]);
    if (visitsRes.error) setError(visitsRes.error.message);
    else setVisits(visitsRes.data ?? []);
    if (staffRes.data) setStaff(staffRes.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(visitId: string, staffId: string) {
    setSavingId(visitId);
    setError(null);
    const { error } = await supabase
      .from("visits")
      .update({ assigned_staff_id: staffId || null, updated_at: new Date().toISOString() })
      .eq("id", visitId);
    setSavingId(null);
    if (error) setError(error.message);
    else {
      setVisits((vs) =>
        vs.map((v) => (v.id === visitId ? { ...v, assigned_staff_id: staffId || null } : v)),
      );
    }
  }

  const when = (v: VisitRow) => {
    const t = v.check_in_time ?? v.scheduled_start;
    return t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  };

  return (
    <div className="card">
      <h3>Visits — last 14 days & upcoming ({visits.length})</h3>
      {error && <p className="error">{error}</p>}
      {visits.map((v) => (
        <div key={v.id} style={{ borderTop: "1px solid #eee", padding: "8px 0" }}>
          <p style={{ margin: 0 }}>
            <strong>{v.dog_label ?? "(no dog label)"}</strong>{" "}
            <span className="muted">
              · {when(v)} · {v.status}
              {v.status === "completed" &&
                ` · ${formatDuration(v.duration_minutes)} · ${formatDistance(v.distance_meters)}`}
              {v.report_sent_at && " · report ✓"}
            </span>
          </p>
          <label style={{ display: "block", marginTop: 4 }}>
            Assigned to{" "}
            <select
              value={v.assigned_staff_id ?? ""}
              disabled={savingId === v.id}
              onChange={(ev) => assign(v.id, ev.target.value)}
            >
              <option value="">— unassigned —</option>
              {staff
                .filter((s) => s.active || s.id === v.assigned_staff_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ))}
      {visits.length === 0 && <p className="muted">No visits in the window.</p>}
    </div>
  );
}
