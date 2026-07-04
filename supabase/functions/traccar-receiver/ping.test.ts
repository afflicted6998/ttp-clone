import { parsePing } from "./ping.ts";
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

console.log(`\n${n} tests passed`);
