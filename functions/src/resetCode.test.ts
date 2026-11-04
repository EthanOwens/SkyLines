import test from "node:test";
import assert from "node:assert/strict";
import { decideSend, docId, generateCode, hashCode, normalizeEmail } from "./resetCode";

test("normalizes and hashes email to a stable id", () => {
  assert.equal(normalizeEmail("  A@B.com "), "a@b.com");
  assert.equal(docId(" A@B.com"), docId("a@b.com"));
  assert.match(docId("a@b.com"), /^[0-9a-f]{64}$/);
});

test("codes are 6 digits and hashed", () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
  assert.notEqual(hashCode("x", "123456"), "123456");
  assert.notEqual(hashCode("x", "123456"), hashCode("y", "123456"));
});

test("send decision: cooldown and hourly limit", () => {
  const now = 10_000_000;
  assert.deepEqual(decideSend([], now), { ok: true, sendTimes: [now] });
  assert.deepEqual(decideSend([now - 20_000], now), { ok: false, reason: "cooldown", retryAfterSeconds: 40 });
  assert.equal(decideSend([now - 61_000], now).ok, true);
  const five = [1, 2, 3, 4, 5].map((i) => now - i * 120_000);
  assert.deepEqual(decideSend(five, now), { ok: false, reason: "too-many-requests" });
  const old = [now - 3_700_000, ...five.slice(0, 4)];
  assert.equal(decideSend(old, now).ok, true);
});
