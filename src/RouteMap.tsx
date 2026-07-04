import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

// The walk route on OpenStreetMap tiles via Leaflet — free, no API key, no
// Google dependency. Start/end are circle markers (Leaflet's default icon
// PNGs don't survive bundling; circles avoid the issue entirely).
export function RouteMap({ points }: { points: RoutePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;
    const map = L.map(containerRef.current);
    mapRef.current = map;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const latLngs = points.map((p) => [p.latitude, p.longitude] as [number, number]);
    if (latLngs.length > 1) {
      const line = L.polyline(latLngs, { color: "#226346", weight: 4 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    } else {
      map.setView(latLngs[0], 17);
    }
    L.circleMarker(latLngs[0], { radius: 7, color: "#226346", fillColor: "#226346", fillOpacity: 1 })
      .addTo(map)
      .bindTooltip("start");
    L.circleMarker(latLngs[latLngs.length - 1], { radius: 7, color: "#FB7939", fillColor: "#FB7939", fillOpacity: 1 })
      .addTo(map)
      .bindTooltip("end");

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points]);

  if (points.length === 0) {
    return <p className="muted">No GPS points recorded for this visit.</p>;
  }
  return <div ref={containerRef} style={{ height: 320, borderRadius: 10 }} />;
}
