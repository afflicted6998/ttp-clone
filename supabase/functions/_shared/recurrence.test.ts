import { expandSchedule, diffOccurrences, localToUtc } from "./recurrence.ts";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

const NY = "America/New_York";
const mwf = {
  rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
  dtstartLocal: "2026-07-06T10:00:00", // a Monday, July = EDT (UTC-4)
  timezone: NY,
  durationMinutes: 30,
};
const win = (a: string, b: string) => [new Date(a), new Date(b)] as const;

check("weekly MO/WE/FR expands correctly in a two-week window", () => {
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-07-20T00:00:00Z");
  const occ = expandSchedule(mwf, [], ws, we);
  assert.equal(occ.length, 6); // Jul 6,8,10,13,15,17
  assert.equal(occ[0].startUtc, "2026-07-06T14:00:00.000Z"); // 10:00 EDT = 14:00Z
  assert.equal(occ[0].endUtc, "2026-07-06T14:30:00.000Z");
  assert.equal(occ[0].originalStartLocal, "2026-07-06T10:00:00");
  assert.equal(occ[0].moved, false);
});

check("wall time survives spring-forward (EST 15:00Z -> EDT 14:00Z)", () => {
  const spec = { ...mwf, rrule: "FREQ=WEEKLY;BYDAY=FR", dtstartLocal: "2026-02-27T10:00:00" };
  const [ws, we] = win("2026-02-27T00:00:00Z", "2026-03-21T00:00:00Z");
  const occ = expandSchedule(spec, [], ws, we);
  // DST starts Mar 8 2026. Feb 27 & Mar 6 are EST; Mar 13 & 20 are EDT.
  assert.deepEqual(
    occ.map((o) => o.startUtc),
    [
      "2026-02-27T15:00:00.000Z",
      "2026-03-06T15:00:00.000Z",
      "2026-03-13T14:00:00.000Z",
      "2026-03-20T14:00:00.000Z",
    ],
  );
  // The wall clock never moved:
  assert(occ.every((o) => o.originalStartLocal.endsWith("T10:00:00")));
});

check("wall time survives fall-back (EDT 14:00Z -> EST 15:00Z)", () => {
  const spec = { ...mwf, rrule: "FREQ=WEEKLY;BYDAY=FR", dtstartLocal: "2026-10-23T10:00:00" };
  const [ws, we] = win("2026-10-23T00:00:00Z", "2026-11-14T00:00:00Z");
  const occ = expandSchedule(spec, [], ws, we);
  // DST ends Nov 1 2026.
  assert.deepEqual(
    occ.map((o) => o.startUtc),
    [
      "2026-10-23T14:00:00.000Z",
      "2026-10-30T14:00:00.000Z",
      "2026-11-06T15:00:00.000Z",
      "2026-11-13T15:00:00.000Z",
    ],
  );
});

check("skip exception removes exactly that occurrence", () => {
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-07-20T00:00:00Z");
  const occ = expandSchedule(
    mwf,
    [{ originalStartLocal: "2026-07-08T10:00:00", kind: "skip" }],
    ws,
    we,
  );
  assert.equal(occ.length, 5);
  assert(!occ.some((o) => o.originalStartLocal === "2026-07-08T10:00:00"));
});

check("moved exception relocates but keeps its original key", () => {
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-07-20T00:00:00Z");
  const occ = expandSchedule(
    mwf,
    [{ originalStartLocal: "2026-07-08T10:00:00", kind: "moved", movedToLocal: "2026-07-09T15:00:00" }],
    ws,
    we,
  );
  const moved = occ.find((o) => o.moved);
  assert(moved);
  assert.equal(moved!.originalStartLocal, "2026-07-08T10:00:00");
  assert.equal(moved!.startUtc, "2026-07-09T19:00:00.000Z"); // 15:00 EDT
});

check("occurrence moved INTO the window from before it is included", () => {
  const [ws, we] = win("2026-07-13T00:00:00Z", "2026-07-20T00:00:00Z");
  const occ = expandSchedule(
    mwf,
    [{ originalStartLocal: "2026-07-08T10:00:00", kind: "moved", movedToLocal: "2026-07-14T10:00:00" }],
    ws,
    we,
  );
  assert(occ.some((o) => o.originalStartLocal === "2026-07-08T10:00:00"));
  assert.equal(occ.length, 4); // Jul 13,15,17 + the moved one
});

check("occurrence moved OUT of the window is excluded", () => {
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-07-13T00:00:00Z");
  const occ = expandSchedule(
    mwf,
    [{ originalStartLocal: "2026-07-08T10:00:00", kind: "moved", movedToLocal: "2026-08-03T10:00:00" }],
    ws,
    we,
  );
  assert(!occ.some((o) => o.originalStartLocal === "2026-07-08T10:00:00"));
  assert.equal(occ.length, 2); // Jul 6, 10
});

check("window start inclusive, end exclusive", () => {
  const occ = expandSchedule(
    mwf,
    [],
    new Date("2026-07-06T14:00:00Z"), // exactly the first start
    new Date("2026-07-08T14:00:00Z"), // exactly the second start
  );
  assert.deepEqual(occ.map((o) => o.startUtc), ["2026-07-06T14:00:00.000Z"]);
});

check("COUNT is respected", () => {
  const spec = { ...mwf, rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=4" };
  const [ws, we] = win("2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z");
  assert.equal(expandSchedule(spec, [], ws, we).length, 4);
});

check("UNTIL is respected", () => {
  const spec = { ...mwf, rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20260711T000000Z" };
  const [ws, we] = win("2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z");
  assert.equal(expandSchedule(spec, [], ws, we).length, 3); // Jul 6, 8, 10
});

check("biweekly INTERVAL=2 skips alternate weeks", () => {
  const spec = { ...mwf, rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO" };
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-08-03T00:00:00Z");
  const occ = expandSchedule(spec, [], ws, we);
  assert.deepEqual(
    occ.map((o) => o.originalStartLocal),
    ["2026-07-06T10:00:00", "2026-07-20T10:00:00"],
  );
});

check("postgres-style local strings accepted", () => {
  const spec = { ...mwf, dtstartLocal: "2026-07-06 10:00:00" };
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-07-07T00:00:00Z");
  assert.equal(expandSchedule(spec, [], ws, we)[0].startUtc, "2026-07-06T14:00:00.000Z");
});

check("unsupported timezone fails loudly", () => {
  assert.throws(
    () => expandSchedule({ ...mwf, timezone: "Europe/Paris" }, [], new Date(), new Date()),
    /unsupported timezone/,
  );
});

check("localToUtc handles both sides of a DST boundary", () => {
  assert.equal(localToUtc("2026-03-07T10:00:00", NY).toISOString(), "2026-03-07T15:00:00.000Z");
  assert.equal(localToUtc("2026-03-09T10:00:00", NY).toISOString(), "2026-03-09T14:00:00.000Z");
});

check("diffOccurrences creates only what is missing", () => {
  const [ws, we] = win("2026-07-06T00:00:00Z", "2026-07-13T00:00:00Z");
  const occ = expandSchedule(mwf, [], ws, we); // Jul 6, 8, 10
  const toCreate = diffOccurrences(occ, ["2026-07-08T14:00:00+00:00"]); // exists, different ISO spelling
  assert.equal(toCreate.length, 2);
  assert(!toCreate.some((o) => o.startUtc === "2026-07-08T14:00:00.000Z"));
});

console.log(`\n${n} tests passed`);
