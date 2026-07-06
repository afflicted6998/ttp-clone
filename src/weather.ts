// Open-Meteo current-conditions fetch + WMO code labels.
// Free endpoint, no API key; commercial licensing is Steve's open item
// (ROADMAP status block) — swap the hostname to the customer endpoint
// (customer-api.open-meteo.com, apikey param) when he sets it up.

export interface WalkWeather {
  temp_c: number;
  code: number;
  wind_kmh: number;
  precip_mm: number;
}

interface OpenMeteoCurrentResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    precipitation?: number;
  };
}

export function parseCurrentWeather(body: OpenMeteoCurrentResponse): WalkWeather | null {
  const c = body.current;
  if (!c || typeof c.temperature_2m !== "number" || typeof c.weather_code !== "number") {
    return null;
  }
  return {
    temp_c: c.temperature_2m,
    code: c.weather_code,
    wind_kmh: typeof c.wind_speed_10m === "number" ? c.wind_speed_10m : 0,
    precip_mm: typeof c.precipitation === "number" ? c.precipitation : 0,
  };
}

// Weather must never block or fail a checkout: short timeout, null on any error.
export async function fetchWalkWeather(
  latitude: number,
  longitude: number,
  timeoutMs = 4000,
): Promise<WalkWeather | null> {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    "&current=temperature_2m,weather_code,wind_speed_10m,precipitation" +
    "&wind_speed_unit=kmh";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return parseCurrentWeather(await res.json());
  } catch {
    return null;
  }
}

// Storage is metric (matches the distance_meters convention); display is
// imperial — DC clients read °F and mph.
export function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh / 1.609344;
}

// One line for the UI and the report card: "88°F · thunderstorm · wind 8 mph"
export function weatherSummary(tempC: number, code: number, windKmh: number): string {
  return `${Math.round(cToF(tempC))}°F · ${weatherCodeLabel(code)} · wind ${Math.round(kmhToMph(windKmh))} mph`;
}

// WMO weather interpretation codes (the ranges Open-Meteo documents).
export function weatherCodeLabel(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code >= 95) return "thunderstorm";
  return "unknown";
}
