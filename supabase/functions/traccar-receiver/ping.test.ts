import { parsePing, jsonBodyToParams } from "./ping.ts";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

// Realistic Traccar Client ping (OsmAnd protocol), epoch seconds.
check("full valid ping", () => {
  const r = parsePing(new URLSearchParams(
    "id=pixel9pro&timestamp=1751652000&lat=38.9847&lon=-77.0947&speed=2.5&batt=85",
  ));
  assert(r.ok, "should parse");
  if (!r.ok) return;
  assert.equal(r.ping.deviceId, "pixel9pro");
  assert.equal(r.ping.latitude, 38.9847);
  assert.equal(r.ping.longitude, -77.0947);
  assert.equal(r.ping.coordinateWkt, "SRID=4326;POINT(-77.0947 38.9847)");
  assert.equal(r.ping.speedMs, 1.29); // 2.5 knots -> m/s, 2dp
  assert.equal(r.ping.batteryLevel, 0.85); // percent -> fraction (NUMERIC(3,2))
  assert.equal(r.ping.recordedAt, new Date(1751652000 * 1000).toISOString());
});

check("minimal ping (no speed/batt)", () => {
  const r = parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=1&lon=2"));
  assert(r.ok);
  if (!r.ok) return;
  assert.equal(r.ping.speedMs, null);
  assert.equal(r.ping.batteryLevel, null);
});

check("millisecond timestamp accepted", () => {
  const r = parsePing(new URLSearchParams("id=x&timestamp=1751652000000&lat=1&lon=2"));
  assert(r.ok);
  if (!r.ok) return;
  assert.equal(r.ping.recordedAt, new Date(1751652000000).toISOString());
});

check("missing device id rejected", () => {
  const r = parsePing(new URLSearchParams("timestamp=1751652000&lat=1&lon=2"));
  assert(!r.ok);
});

check("deviceid alias accepted", () => {
  const r = parsePing(new URLSearchParams("deviceid=x&timestamp=1751652000&lat=1&lon=2"));
  assert(r.ok);
});

check("missing lat rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=1751652000&lon=2")).ok);
});

check("non-numeric lat rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=abc&lon=2")).ok);
});

// Number("") === 0, so an empty param must be rejected, not become
// coordinate (0,0) / epoch 1970 (Gemini review of PR #3, finding 1).
check("EMPTY lat/lon rejected, not parsed as (0,0)", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=&lon=")).ok);
});

check("whitespace lat rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=%20&lon=2")).ok);
});

check("EMPTY timestamp rejected, not parsed as 1970", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=&lat=1&lon=2")).ok);
});

check("EMPTY speed/batt become null, not 0", () => {
  const r = parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=1&lon=2&speed=&batt="));
  assert(r.ok);
  if (!r.ok) return;
  assert.equal(r.ping.speedMs, null);
  assert.equal(r.ping.batteryLevel, null);
});

check("out-of-range lat rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=91&lon=2")).ok);
});

check("out-of-range lon rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=1&lon=181")).ok);
});

check("missing timestamp rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&lat=1&lon=2")).ok);
});

check("non-numeric timestamp rejected", () => {
  assert(!parsePing(new URLSearchParams("id=x&timestamp=yesterday&lat=1&lon=2")).ok);
});

check("battery over 100 clamps to 1.00", () => {
  const r = parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=1&lon=2&batt=120"));
  assert(r.ok);
  if (!r.ok) return;
  assert.equal(r.ping.batteryLevel, 1);
});

check("zero lat/lon are valid (not falsy-rejected)", () => {
  const r = parsePing(new URLSearchParams("id=x&timestamp=1751652000&lat=0&lon=0"));
  assert(r.ok);
});

check("ISO-8601 timestamp accepted (JSON clients)", () => {
  const r = parsePing(new URLSearchParams(
    "id=x&lat=38.98&lon=-77.09&timestamp=2026-07-05T15:30:00.000Z",
  ));
  assert(r.ok);
  if (!r.ok) return;
  assert.equal(r.ping.recordedAt, "2026-07-05T15:30:00.000Z");
});

check("TransistorSoft-style JSON body flattens and parses", () => {
  const params = new URLSearchParams("token=t");
  const count = jsonBodyToParams(
    {
      location: {
        timestamp: "2026-07-05T15:30:00.000Z",
        coords: { latitude: 38.9847, longitude: -77.0947, speed: 1.4 },
        battery: { level: 0.85 },
      },
      device_id: "pixel9pro",
    },
    params,
  );
  assert.equal(count, 1);
  const r = parsePing(params);
  assert(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.ping.deviceId, "pixel9pro");
  assert.equal(r.ping.latitude, 38.9847);
  assert.equal(r.ping.speedMs, 1.4); // already m/s — no knots conversion
  assert.equal(r.ping.batteryLevel, 0.85); // 0-1 fraction passes through
  assert.equal(r.ping.recordedAt, "2026-07-05T15:30:00.000Z");
});

check("JSON batch reports its length; first fix wins", () => {
  const params = new URLSearchParams();
  const count = jsonBodyToParams(
    {
      location: [
        { timestamp: 1751652000, coords: { latitude: 1, longitude: 2 } },
        { timestamp: 1751652030, coords: { latitude: 3, longitude: 4 } },
      ],
      device_id: "x",
    },
    params,
  );
  assert.equal(count, 2);
  assert.equal(params.get("lat"), "1");
});

check("URL query params win over JSON body", () => {
  const params = new URLSearchParams("id=urlwins");
  jsonBodyToParams({ device_id: "bodyloses", location: { coords: { latitude: 1, longitude: 2 }, timestamp: 1751652000 } }, params);
  assert.equal(params.get("id"), "urlwins");
});

check("flat JSON (no location wrapper) still flattens", () => {
  const params = new URLSearchParams();
  jsonBodyToParams({ id: "x", lat: 5, lon: 6, timestamp: 1751652000 }, params);
  assert(parsePing(params).ok);
});

check("non-object JSON body is a no-op", () => {
  const params = new URLSearchParams("a=1");
  assert.equal(jsonBodyToParams("garbage", params), 0);
  assert.equal(params.toString(), "a=1");
});

console.log(`\n${n} tests passed`);
