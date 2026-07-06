import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { RouteMap, type RoutePoint } from "./RouteMap";
import { fetchMediaWithUrls, type MediaItem } from "./mediaList";
import { formatDistance, formatDuration } from "./format";
import { weatherSummary } from "./weather";

interface VisitRow {
  id: string;
  dog_label: string | null;
  terrain_tag: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  duration_minutes: number | null;
  distance_meters: number | null;
  pee_count: number;
  poop_count: number;
  weather_temp_c: number | null;
  weather_code: number | null;
  weather_wind_kmh: number | null;
  calendar_events: { title: string | null } | null;
}

// The read-only payoff screen: everything TTP hoards, together, out of
// YOUR database — route, media, timer, distance, appointment context.
export function VisitDetail({
  visitId,
  onBack,
}: {
  visitId: string;
  onBack: () => void;
}) {
  const [visit, setVisit] = useState<VisitRow | null>(null);
  const [points, setPoints] = useState<RoutePoint[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [visitRes, logsRes, mediaRows] = await Promise.all([
        supabase
          .from("visits")
          .select(
            "id, dog_label, terrain_tag, check_in_time, check_out_time, duration_minutes, distance_meters, pee_count, poop_count, weather_temp_c, weather_code, weather_wind_kmh, calendar_events(title)",
          )
          .eq("id", visitId)
          .maybeSingle(),
        supabase
          .from("location_logs")
          .select("latitude, longitude")
          .eq("visit_id", visitId)
          .order("recorded_at"),
        fetchMediaWithUrls(visitId),
      ]);
      if (visitRes.error) setError(visitRes.error.message);
      else setVisit(visitRes.data as VisitRow | null);
      setPoints((logsRes.data ?? []).map((p) => ({
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
      })));
      setMedia(mediaRows);
    })();
  }, [visitId]);

  if (error) return <p className="error">{error}</p>;
  if (!visit) return <p className="muted">Loading…</p>;

  return (
    <div>
      <button className="secondary" onClick={onBack}>← Back</button>

      <div className="card">
        <h2>{visit.dog_label ?? "(no dog label)"}</h2>
        {visit.calendar_events?.title && (
          <p className="muted">Appointment: {visit.calendar_events.title}</p>
        )}
        <p>
          <strong>{formatDuration(visit.duration_minutes)}</strong> ·{" "}
          <strong>{formatDistance(visit.distance_meters)}</strong> ·{" "}
          {points.length} GPS points
        </p>
        <p>
          💧 ×{visit.pee_count} · 💩 ×{visit.poop_count}
        </p>
        <p className="muted">
          {visit.check_in_time && new Date(visit.check_in_time).toLocaleString()}
          {visit.check_out_time &&
            ` → ${new Date(visit.check_out_time).toLocaleTimeString()}`}
        </p>
        {visit.terrain_tag && <p>Terrain: {visit.terrain_tag}</p>}
        {visit.weather_temp_c !== null && visit.weather_code !== null && (
          <p>
            Weather:{" "}
            {weatherSummary(
              Number(visit.weather_temp_c),
              visit.weather_code,
              Number(visit.weather_wind_kmh ?? 0),
            )}
          </p>
        )}
      </div>

      <div className="card">
        <RouteMap points={points} />
      </div>

      {media.length > 0 && (
        <div className="card">
          <h3>Media ({media.length})</h3>
          {media.map((m) =>
            m.type === "photo" ? (
              <img
                key={m.id}
                src={m.signedUrl}
                alt={`photo ${new Date(m.captured_at).toLocaleTimeString()}`}
                style={{ maxWidth: "100%", borderRadius: 8, marginTop: 8 }}
              />
            ) : (
              <p key={m.id}>
                <a href={m.signedUrl} target="_blank" rel="noreferrer">
                  ▶ video {new Date(m.captured_at).toLocaleTimeString()}
                </a>
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}
