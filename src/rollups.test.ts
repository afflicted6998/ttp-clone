import { mondayOf, weeklyRollups } from "./rollups";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("mondayOf: any day maps to that week's Monday", () => {
  assert.equal(mondayOf(new Date(2026, 6, 5)), "2026-06-29"); // Sun Jul 5 → Mon Jun 29
  assert.equal(mondayOf(new Date(2026, 6, 6)), "2026-07-06"); // Mon maps to itself
  assert.equal(mondayOf(new Date(2026, 6, 12)), "2026-07-06"); // next Sun still same week
});

check("weeklyRollups groups, sums, and sorts newest-first", () => {
  const rollups = weeklyRollups([
    { check_in_time: new Date(2026, 6, 6, 10).toISOString(), duration_minutes: 30, distance_meters: 1500 },
    { check_in_time: new Date(2026, 6, 8, 10).toISOString(), duration_minutes: 45, distance_meters: 2500 },
    { check_in_time: new Date(2026, 5, 30, 10).toISOString(), duration_minutes: 20, distance_meters: 1000 },
  ]);
  assert.equal(rollups.length, 2);
  assert.deepEqual(rollups[0], {
    weekStart: "2026-07-06",
    walks: 2,
    totalMinutes: 75,
    totalMeters: 4000,
  });
  assert.equal(rollups[1].weekStart, "2026-06-29");
  assert.equal(rollups[1].walks, 1);
});

check("null duration/distance count as walks, add zero", () => {
  const [r] = weeklyRollups([
    { check_in_time: new Date(2026, 6, 7, 9).toISOString(), duration_minutes: null, distance_meters: null },
  ]);
  assert.equal(r.walks, 1);
  assert.equal(r.totalMinutes, 0);
  assert.equal(r.totalMeters, 0);
});

console.log(`${n} rollup tests passed`);
