import { blankToNull, nullToBlank } from "./formUtils";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("blank and whitespace-only become null", () => {
  assert.equal(blankToNull(""), null);
  assert.equal(blankToNull("   "), null);
  assert.equal(blankToNull("\n\t"), null);
});

check("real values are trimmed, not nulled", () => {
  assert.equal(blankToNull("  Kevin Jiles "), "Kevin Jiles");
});

check("nulls render as empty inputs", () => {
  assert.equal(nullToBlank(null), "");
  assert.equal(nullToBlank(undefined), "");
  assert.equal(nullToBlank("x"), "x");
});

console.log(`${n} form-utils tests passed`);
