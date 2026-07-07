// Tests for the Stripe webhook signature check and form encoder — the two
// pieces where a bug is silent and dangerous (a forged webhook could flip a
// visit to "paid"; a bad encoder could charge the wrong amount).
//
// Runs under tsx/Node; Deno provides `crypto` globally at runtime, so we shim
// Node's webcrypto onto globalThis to exercise the exact same code path.
import assert from "node:assert";
import { createHmac, webcrypto } from "node:crypto";
// deno-lint-ignore no-explicit-any
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import { encodeForm, verifyStripeSignature } from "./stripe.ts";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(
    () => {
      console.log(`ok ${++passed} - ${name}`);
    },
    (e) => {
      console.error(`FAIL - ${name}`);
      console.error(e);
      process.exit(1);
    },
  );
}

const SECRET = "whsec_testsecret";
function signedHeader(body: string, secret = SECRET, t = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

await test("valid signature parses the event", async () => {
  const body = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
  const event = await verifyStripeSignature(body, signedHeader(body), SECRET);
  assert.equal(event.id, "evt_1");
  assert.equal(event.type, "payment_intent.succeeded");
});

await test("tampered body is rejected", async () => {
  const body = JSON.stringify({ id: "evt_1", amount: 100 });
  const header = signedHeader(body);
  const forged = JSON.stringify({ id: "evt_1", amount: 999999 });
  await assert.rejects(() => verifyStripeSignature(forged, header, SECRET));
});

await test("wrong secret is rejected", async () => {
  const body = JSON.stringify({ id: "evt_1" });
  await assert.rejects(() => verifyStripeSignature(body, signedHeader(body), "whsec_wrong"));
});

await test("stale timestamp is rejected (replay window)", async () => {
  const body = JSON.stringify({ id: "evt_1" });
  const old = Math.floor(Date.now() / 1000) - 10_000;
  await assert.rejects(() => verifyStripeSignature(body, signedHeader(body, SECRET, old), SECRET));
});

await test("missing or malformed header is rejected", async () => {
  const body = "{}";
  await assert.rejects(() => verifyStripeSignature(body, null, SECRET));
  await assert.rejects(() => verifyStripeSignature(body, "garbage", SECRET));
});

await test("multiple v1 signatures: any match passes", async () => {
  const body = JSON.stringify({ id: "evt_2" });
  const t = Math.floor(Date.now() / 1000);
  const good = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  const header = `t=${t},v1=deadbeef,v1=${good}`;
  const event = await verifyStripeSignature(body, header, SECRET);
  assert.equal(event.id, "evt_2");
});

await test("encodeForm drops undefined/null, keeps bracket keys", () => {
  const s = encodeForm({
    amount: 2850,
    currency: "usd",
    off_session: true,
    description: undefined,
    "metadata[visit_id]": "abc",
    nothing: null,
  });
  const params = new URLSearchParams(s);
  assert.equal(params.get("amount"), "2850");
  assert.equal(params.get("off_session"), "true");
  assert.equal(params.get("metadata[visit_id]"), "abc");
  assert.equal(params.has("description"), false);
  assert.equal(params.has("nothing"), false);
});

console.log(`\n${passed} stripe tests passed`);
