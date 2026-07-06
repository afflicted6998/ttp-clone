import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { MediaCapture } from "./MediaCapture";
import { fetchWalkWeather } from "./weather";
import { splitDogLabel } from "./dogLabel";
import type { Visit } from "./Home";

export function ActiveVisit({
  visit,
  onCheckedOut,
}: {
  visit: Visit;
  onCheckedOut: (reportMessage?: string) => void;
}) {
  const [terrain, setTerrain] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pingCount, setPingCount] = useState<number | null>(null);
  const dogs = splitDogLabel(visit.dog_label);

  const [status, setStatus] = useState({
    pee: visit.pee_dogs || [],
    poop: visit.poop_dogs || [],
  });
  // Ref mirrors status so rapid taps never compute from a stale render.
  const statusRef = useRef(status);

  // Registered dogs on this visit (visit_dogs junction, created at check-in
  // when dogs are picked from the CRM). Non-empty → toggles write per-dog
  // booleans on the junction; empty → the dog_label/array bridge below.
  interface JunctionDog {
    dog_id: string;
    name: string;
    peed: boolean;
    pooped: boolean;
  }
  const [junctionDogs, setJunctionDogs] = useState<JunctionDog[]>([]);
  const junctionRef = useRef<JunctionDog[]>([]);

  useEffect(() => {
    supabase
      .from("visit_dogs")
      .select("dog_id, peed, pooped, dogs(name)")
      .eq("visit_id", visit.id)
      .then(({ data }) => {
        const rows = (data ?? []).map((r) => ({
          dog_id: r.dog_id as string,
          peed: Boolean(r.peed),
          pooped: Boolean(r.pooped),
          name: (r.dogs as unknown as { name: string } | null)?.name ?? "?",
        }));
        junctionRef.current = rows;
        setJunctionDogs(rows);
      });
  }, [visit.id]);

  function toggleJunction(dogId: string, kind: "peed" | "pooped") {
    const rows = junctionRef.current.map((r) =>
      r.dog_id === dogId ? { ...r, [kind]: !r[kind] } : r,
    );
    junctionRef.current = rows;
    setJunctionDogs(rows);
    const row = rows.find((r) => r.dog_id === dogId)!;
    supabase
      .from("visit_dogs")
      .update({ [kind]: row[kind] })
      .eq("visit_id", visit.id)
      .eq("dog_id", dogId)
      .then(({ error }) => {
        if (error) setError(`status save: ${error.message}`);
      });
  }

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
    const notesTrimmed = notes.trim();
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
        visit_notes: notesTrimmed || null,
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
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Fire the report card. Its failure never un-completes a checkout — the
    // detail screen has a "Send report card" button for retries.
    const { data: sent, error: sendErr } = await supabase.functions.invoke("report-card", {
      body: { visit_id: visit.id },
    });
    setBusy(false);
    onCheckedOut(
      sendErr
        ? `Walk saved — report email failed (${sendErr.message}); resend it from the visit's detail screen`
        : `Walk saved — report emailed in ${Math.round(((sent as { elapsed_ms?: number })?.elapsed_ms ?? 0) / 100) / 10}s`,
    );
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
        {junctionDogs.length > 0
          ? junctionDogs.map((d) => (
              <div key={d.dog_id} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <span style={{ width: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.name}
                </span>
                <button
                  className={d.peed ? "" : "secondary"}
                  style={{ flex: 1 }}
                  onClick={() => toggleJunction(d.dog_id, "peed")}
                >
                  💧 Pee
                </button>
                <button
                  className={d.pooped ? "" : "secondary"}
                  style={{ flex: 1 }}
                  onClick={() => toggleJunction(d.dog_id, "pooped")}
                >
                  💩 Poop
                </button>
              </div>
            ))
          : dogs.map(dog => (
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
        Note for the client's report
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="How the walk went — this is the message the client reads"
        />
      </label>

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
