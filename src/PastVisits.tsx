import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { formatDistance, formatDuration } from "./format";

interface PastVisit {
  id: string;
  dog_label: string | null;
  check_in_time: string | null;
  duration_minutes: number | null;
  distance_meters: number | null;
}

export function PastVisits({ onOpen }: { onOpen: (visitId: string) => void }) {
  const [visits, setVisits] = useState<PastVisit[]>([]);

  useEffect(() => {
    // RLS scopes this to the signed-in walker's own visits.
    supabase
      .from("visits")
      .select("id, dog_label, check_in_time, duration_minutes, distance_meters")
      .eq("status", "completed")
      .order("check_in_time", { ascending: false, nullsFirst: false })
      .limit(20)
      .then(({ data }) => setVisits(data ?? []));
  }, []);

  if (visits.length === 0) return null;

  return (
    <div className="card">
      <h2>Past visits</h2>
      {visits.map((v) => (
        <p key={v.id}>
          <a href="#" onClick={(e) => { e.preventDefault(); onOpen(v.id); }}>
            {v.check_in_time ? new Date(v.check_in_time).toLocaleString() : "?"} —{" "}
            {v.dog_label ?? "(no label)"}
          </a>{" "}
          <span className="muted">
            {formatDuration(v.duration_minutes)} · {formatDistance(v.distance_meters)}
          </span>
        </p>
      ))}
    </div>
  );
}
