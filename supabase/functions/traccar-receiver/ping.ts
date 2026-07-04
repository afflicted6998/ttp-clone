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

/** A finite number from a query param, or null for absent/empty/garbage. */
function finiteOrNull(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the OsmAnd-protocol parameters Traccar Client sends.
 * Required: id, lat, lon, timestamp. Optional: speed (knots), batt (percent).
 * `timestamp` is unix epoch; Traccar sends seconds, but accept milliseconds
 * too (values past year 2286 in seconds are treated as ms).
 */
export function parsePing(params: URLSearchParams): PingResult {
  const deviceId = params.get("id") ?? params.get("deviceid");
  if (!deviceId) return { ok: false, error: "missing device id" };

  // Number("") and Number("  ") are 0, not NaN — an empty lat= must be
  // rejected here, not silently become coordinate (0,0) and wreck the
  // PostGIS distance for the whole walk (Gemini review of PR #3, finding 1).
  const lat = finiteOrNull(params.get("lat"));
  const lon = finiteOrNull(params.get("lon"));
  if (lat === null || lon === null) {
    return { ok: false, error: "missing, empty, or non-numeric lat/lon" };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, error: "lat/lon out of range" };
  }

  const tsNum = finiteOrNull(params.get("timestamp"));
  if (tsNum === null) {
    return { ok: false, error: "missing, empty, or non-numeric timestamp" };
  }
  const epochMs = tsNum > 9_999_999_999 ? tsNum : tsNum * 1000;
  const recorded = new Date(epochMs);
  if (Number.isNaN(recorded.getTime())) {
    return { ok: false, error: "unparseable timestamp" };
  }

  // Same empty-string trap for the optional fields: speed= must stay null,
  // not become 0 m/s (which would look like a real standstill reading).
  const rawSpeed = finiteOrNull(params.get("speed"));
  const speedMs = rawSpeed !== null ? Math.round(rawSpeed * KNOTS_TO_MS * 100) / 100 : null;

  const rawBatt = finiteOrNull(params.get("batt"));
  let batteryLevel: number | null = null;
  if (rawBatt !== null) {
    batteryLevel = Math.min(Math.max(rawBatt / 100, 0), 1);
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
