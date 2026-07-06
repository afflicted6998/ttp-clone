import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { MediaCapture } from "./MediaCapture";
import { fetchWalkWeather } from "./weather";
import type { Visit } from "./Home";

export function ActiveVisit({
  visit,
  onCheckedOut,
}: {
  visit: Visit;
  onCheckedOut: () => void;
}) {
  const [terrain, setTerrain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pingCount, setPingCount] = useState<number | null>(null);
  const dogs = (visit.dog_label || "Unknown Dog")
    .split(/\s+(?:and|&)\s+|,/)
    .map(s => s.trim())
    .filter(Boolean);
  if (dogs.length === 0) dogs.push("Unknown Dog");

  const [status, setStatus] = useState({
    pee: visit.pee_dogs || [],
    poop: visit.poop_dogs || [],
  });
  // Ref mirrors status so rapid taps never compute from a stale render.
  const statusRef = useRef(status);

  // Each tap persists immediately: the phone spends most of the walk locked
  // in a pocket, and a killed tab must not lose tap data. Out-of-order
  // responses could briefly persist a stale count; checkout's final write
  // settles it authoritatively.
  function toggle(kind: "pee" | "poop", dog: string) {
    const currentList = statusRef.current[kind];
    const nextList = currentList.includes(dog)
      ? currentList.filter(d => d !== dog)
      : [...currentList, dog];

    const next = {
      ...statusRef.current,
      [kind]: nextList,
    };
    statusRef.current = next;
    setStatus(next);
    supabase
      .from("visits")
      .update({
        pee_dogs: next.pee,
        poop_dogs: next.poop,
        updated_at: new Date().toISOString(),
      })
      .eq("id", visit.id)
      .then(({ error }) => {
        if (error) setError(`status save: ${error.message}`);
      });
  }

  // Field-test aid (QA core test step 4): live count of GPS points landing
  // for this visit, so a dead Traccar config is visible before the walk.
  const refreshPings = useCallback(async () => {
    const { count } = await supabase
      .from("location_logs")
      .select("id", { count: "exact", head: true })
      .eq("visit_id", visit.id);
    setPingCount(count ?? 0);
  }, [visit.id]);

  useEffect(() => {
    refreshPings();
  }, [refreshPings]);

  async function checkOut() {
    setBusy(true);
    setError(null);
    const checkOutTime = new Date().toISOString(); // before the weather fetch, so the timestamp is honest
    // Weather enrichment from the walk's own last GPS fix (Open-Meteo,
    // keyless). Null on any failure — weather never blocks a checkout.
    const { data: lastPoint } = await supabase
      .from("location_logs")
      .select("latitude, longitude")
      .eq("visit_id", visit.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const weather = lastPoint
      ? await fetchWalkWeather(Number(lastPoint.latitude), Number(lastPoint.longitude))
      : null;
    const { error } = await supabase
      .from("visits")
      .update({
        status: "completed",
        check_out_time: checkOutTime,
        terrain_tag: terrain.trim() || null,
        pee_dogs: statusRef.current.pee,
        poop_dogs: statusRef.current.poop,
        ...(weather && {
          weather_temp_c: weather.temp_c,
          weather_code: weather.code,
          weather_wind_kmh: weather.wind_kmh,
          weather_precip_mm: weather.precip_mm,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", visit.id);
    setBusy(false);
    if (error) setError(error.message);
    else onCheckedOut();
  }

  return (
    <div className="card">
      <h2>Walk in progress</h2>
      <p>
        <strong>{visit.dog_label ?? "(no dog label)"}</strong>
        <br />
        <span className="muted">
          Checked in{" "}
          {visit.check_in_time ? new Date(visit.check_in_time).toLocaleTimeString() : "?"}
        </span>
      </p>

      <p>
        GPS points received: <strong>{pingCount ?? "…"}</strong>{" "}
        <a href="#" onClick={(e) => { e.preventDefault(); refreshPings(); }}>
          refresh
        </a>
      </p>
      {pingCount === 0 && (
        <p className="error">
          No GPS points yet — check Traccar Client's status screen (tracking
          on? correct server URL?).
        </p>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Pee & Poop</h3>
        {dogs.map(dog => (
          <div key={dog} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <span style={{ width: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {dog}
            </span>
            <button
              className={status.pee.includes(dog) ? "" : "secondary"}
              style={{ flex: 1 }}
              onClick={() => toggle("pee", dog)}
            >
              💧 Pee
            </button>
            <button
              className={status.poop.includes(dog) ? "" : "secondary"}
              style={{ flex: 1 }}
              onClick={() => toggle("poop", dog)}
            >
              💩 Poop
            </button>
          </div>
        ))}
      </div>

      <MediaCapture visitId={visit.id} />

      <label>
        Terrain note
        <textarea
          value={terrain}
          onChange={(e) => setTerrain(e.target.value)}
          rows={2}
          placeholder="e.g. muddy towpath, gravel"
        />
      </label>

      <button onClick={checkOut} disabled={busy}>
        {busy ? "Checking out…" : "Check out"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
