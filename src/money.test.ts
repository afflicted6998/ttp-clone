import { centsToDollars, dollarsToCents } from "./money";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("plain dollar amounts", () => {
  assert.equal(dollarsToCents("24"), 2400);
  assert.equal(dollarsToCents("24.5"), 2450);
  assert.equal(dollarsToCents("24.50"), 2450);
  assert.equal(dollarsToCents("0.99"), 99);
});

check("the float trap: 24.10 parses to exactly 2410", () => {
  assert.equal(dollarsToCents("24.10"), 2410); // parseFloat*100 gives 2409.999…
});

check("dollar signs, commas, whitespace tolerated", () => {
  assert.equal(dollarsToCents("$24.50"), 2450);
  assert.equal(dollarsToCents(" 1,250.00 "), 125000);
});

check("garbage rejected, not coerced", () => {
  assert.equal(dollarsToCents(""), null);
  assert.equal(dollarsToCents("abc"), null);
  assert.equal(dollarsToCents("24.999"), null); // sub-cent
  assert.equal(dollarsToCents("-5"), null); // negatives typed by hand are a mistake
  assert.equal(dollarsToCents("24.5.0"), null);
});

check("cents render as dollars", () => {
  assert.equal(centsToDollars(2450), "$24.50");
  assert.equal(centsToDollars(99), "$0.99");
  assert.equal(centsToDollars(0), "$0.00");
  assert.equal(centsToDollars(-500), "-$5.00");
});

console.log(`${n} money tests passed`);
