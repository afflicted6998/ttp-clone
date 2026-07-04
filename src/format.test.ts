import { formatDistance, formatDuration } from "./format";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("distance under a km in meters", () => {
  assert.equal(formatDistance(870.4), "870 m");
});

check("distance over a km in km with 2dp", () => {
  assert.equal(formatDistance(2416), "2.42 km");
});

check("null distance renders a dash (pre-checkout / PR #9 not applied)", () => {
  assert.equal(formatDistance(null), "—");
});

check("duration under an hour", () => {
  assert.equal(formatDuration(42.4), "42 min");
});

check("duration over an hour", () => {
  assert.equal(formatDuration(65), "1 h 05 min");
});

check("null duration renders a dash", () => {
  assert.equal(formatDuration(null), "—");
});

console.log(`\n${n} tests passed`);
