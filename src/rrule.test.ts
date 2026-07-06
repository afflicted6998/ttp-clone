import { parseWeeklyRrule, weeklyRrule } from "./rrule";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("builds the MWF rule in canonical day order regardless of pick order", () => {
  assert.equal(weeklyRrule(["FR", "MO", "WE"]), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
});

check("round-trips through the parser", () => {
  assert.deepEqual(parseWeeklyRrule(weeklyRrule(["TU", "TH"])), ["TU", "TH"]);
});

check("non-weekly and malformed rules return null (free-text path)", () => {
  assert.equal(parseWeeklyRrule("FREQ=DAILY"), null);
  assert.equal(parseWeeklyRrule("FREQ=WEEKLY;BYDAY=MO;INTERVAL=2"), null);
  assert.equal(parseWeeklyRrule("FREQ=WEEKLY;BYDAY=XX"), null);
});

check("empty day set refuses to build", () => {
  assert.throws(() => weeklyRrule([]));
});

console.log(`${n} rrule tests passed`);
