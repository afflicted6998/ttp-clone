// Pure parsing/conversion logic for Traccar (OsmAnd protocol) pings.
// No Deno or Supabase imports here, so this file is unit-testable with plain Node.

export interface ParsedPing {
  deviceId: string;
  latitude: number;
  longitude: number;
  /** WKT for the PostGIS column, e.g. "SRID=4326;POINT(-77.03 38.90)" (lon lat order). */
  coordinateWkt: string;
  /** m/s; Traccar sends knots. Null when not reported. */
  speedMs: number | null;
  /** Fraction 0.00–1.00; Traccar sends percent. Null when not reported.
      battery_level is NUMERIC(3,2) — a raw percent like 85 would not fit. */
  batteryLevel: number | null;
  /** ISO timestamp of the fix itself (device clock), distinct from upload time. */
  recordedAt: string;
}

export type PingResult =
  | { ok: true; ping: ParsedPing }
  | { ok: false; error: string };

const KNOTS_TO_MS = 0.514444;

/**
 * Parse the OsmAnd-protocol parameters Traccar Client sends.
 * Required: id, lat, lon, timestamp. Optional: speed (knots), batt (percent).
 * `timestamp` is unix epoch; Traccar sends seconds, but accept milliseconds
 * too (values past year 2286 in seconds are treated as ms).
 */
export function parsePing(params: URLSearchParams): PingResult {
  const deviceId = params.get("id") ?? params.get("deviceid");
  if (!deviceId) return { ok: false, error: "missing device id" };

  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (params.get("lat") === null || params.get("lon") === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, error: "missing or non-numeric lat/lon" };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, error: "lat/lon out of range" };
  }

  const rawTs = params.get("timestamp");
  if (rawTs === null || !Number.isFinite(Number(rawTs))) {
    return { ok: false, error: "missing or non-numeric timestamp" };
  }
  const tsNum = Number(rawTs);
  const epochMs = tsNum > 9_999_999_999 ? tsNum : tsNum * 1000;
  const recorded = new Date(epochMs);
  if (Number.isNaN(recorded.getTime())) {
    return { ok: false, error: "unparseable timestamp" };
  }

  const rawSpeed = params.get("speed");
  const speedMs =
    rawSpeed !== null && Number.isFinite(Number(rawSpeed))
      ? Math.round(Number(rawSpeed) * KNOTS_TO_MS * 100) / 100
      : null;

  const rawBatt = params.get("batt");
  let batteryLevel: number | null = null;
  if (rawBatt !== null && Number.isFinite(Number(rawBatt))) {
    batteryLevel = Math.min(Math.max(Number(rawBatt) / 100, 0), 1);
    batteryLevel = Math.round(batteryLevel * 100) / 100;
  }

  return {
    ok: true,
    ping: {
      deviceId,
      latitude: lat,
      longitude: lon,
      coordinateWkt: `SRID=4326;POINT(${lon} ${lat})`,
      speedMs,
      batteryLevel,
      recordedAt: recorded.toISOString(),
    },
  };
}
