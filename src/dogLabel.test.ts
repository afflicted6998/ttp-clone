import { splitDogLabel } from "./dogLabel";
import assert from "node:assert";

let n = 0;
function check(name: string, fn: () => void) {
  n++;
  fn();
  console.log(`ok ${n} - ${name}`);
}

check("the Samson and Reba case", () => {
  assert.deepEqual(splitDogLabel("Samson and Reba"), ["Samson", "Reba"]);
});

check("case-insensitive 'And' (review fix — Gemini's regex missed it)", () => {
  assert.deepEqual(splitDogLabel("Samson And Reba"), ["Samson", "Reba"]);
});

check("ampersand, with or without spaces", () => {
  assert.deepEqual(splitDogLabel("Samson & Reba"), ["Samson", "Reba"]);
  assert.deepEqual(splitDogLabel("Samson&Reba"), ["Samson", "Reba"]);
});

check("comma-separated, plus a three-dog mix", () => {
  assert.deepEqual(splitDogLabel("Samson, Reba"), ["Samson", "Reba"]);
  assert.deepEqual(splitDogLabel("Samson, Reba and Max"), ["Samson", "Reba", "Max"]);
});

check("names containing 'and' inside a word never split", () => {
  assert.deepEqual(splitDogLabel("Sandy"), ["Sandy"]);
  assert.deepEqual(splitDogLabel("Brandy and Sandy"), ["Brandy", "Sandy"]);
});

check("single dog passes through", () => {
  assert.deepEqual(splitDogLabel("Slushy"), ["Slushy"]);
});

check("null/empty label falls back to a placeholder", () => {
  assert.deepEqual(splitDogLabel(null), ["Unknown Dog"]);
  assert.deepEqual(splitDogLabel("   "), ["Unknown Dog"]);
});

console.log(`${n} dog-label tests passed`);
