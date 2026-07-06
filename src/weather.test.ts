import { parseCurrentWeather, weatherCodeLabel, weatherSummary } from "./weather";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("parses a normal current-conditions response", () => {
  const w = parseCurrentWeather({
    current: {
      temperature_2m: 31.4,
      weather_code: 95,
      wind_speed_10m: 12.3,
      precipitation: 0.8,
    },
  });
  assert.deepEqual(w, { temp_c: 31.4, code: 95, wind_kmh: 12.3, precip_mm: 0.8 });
});

check("missing current block → null (never a checkout error)", () => {
  assert.equal(parseCurrentWeather({}), null);
});

check("missing temperature or code → null, not NaN garbage", () => {
  assert.equal(parseCurrentWeather({ current: { weather_code: 3 } }), null);
  assert.equal(parseCurrentWeather({ current: { temperature_2m: 20 } }), null);
});

check("optional wind/precip default to 0", () => {
  const w = parseCurrentWeather({ current: { temperature_2m: 0, weather_code: 0 } });
  assert.deepEqual(w, { temp_c: 0, code: 0, wind_kmh: 0, precip_mm: 0 });
});

check("zero temperature is valid, not falsy-dropped", () => {
  assert.equal(parseCurrentWeather({ current: { temperature_2m: 0, weather_code: 71 } })?.temp_c, 0);
});

check("WMO code labels cover the documented ranges", () => {
  assert.equal(weatherCodeLabel(0), "clear");
  assert.equal(weatherCodeLabel(2), "partly cloudy");
  assert.equal(weatherCodeLabel(3), "overcast");
  assert.equal(weatherCodeLabel(48), "fog");
  assert.equal(weatherCodeLabel(53), "drizzle");
  assert.equal(weatherCodeLabel(65), "rain");
  assert.equal(weatherCodeLabel(75), "snow");
  assert.equal(weatherCodeLabel(81), "rain showers");
  assert.equal(weatherCodeLabel(86), "snow showers");
  assert.equal(weatherCodeLabel(96), "thunderstorm");
  assert.equal(weatherCodeLabel(42), "unknown");
});

check("unit conversions", () => {
  assert.equal(weatherSummary(31.4, 95, 12.9), "89°F · thunderstorm · wind 8 mph");
  assert.equal(weatherSummary(0, 71, 0), "32°F · snow · wind 0 mph");
});

console.log(`${n} weather tests passed`);
