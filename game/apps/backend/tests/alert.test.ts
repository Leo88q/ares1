import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_LADDER,
  buildAlert,
  shouldAlert,
  sendAlert,
  type FetchLike,
} from "../src/alert";

test("shouldAlert fires exactly on the 3/9/27 ladder", () => {
  assert.equal(shouldAlert(1), false);
  assert.equal(shouldAlert(2), false);
  assert.equal(shouldAlert(3), true);
  assert.equal(shouldAlert(4), false);
  assert.equal(shouldAlert(9), true);
  assert.equal(shouldAlert(27), true);
  assert.equal(shouldAlert(28), false);
  assert.deepEqual([...ALERT_LADDER], [3, 9, 27]);
});

test("buildAlert carries service/severity/event and optional counter", () => {
  const p = buildAlert("epoch_roll_failures", "3 consecutive roll failures", 3, () => "T0");
  assert.equal(p.service, "ares1-backend");
  assert.equal(p.severity, "critical");
  assert.equal(p.event, "epoch_roll_failures");
  assert.equal(p.consecutiveFailures, 3);
  assert.equal(p.at, "T0");
  const q = buildAlert("payer_balance_fatal", "balance below floor", undefined, () => "T1");
  assert.equal(q.consecutiveFailures, undefined);
  assert.equal("consecutiveFailures" in q, false);
});

test("sendAlert posts JSON and reports success", async () => {
  const calls: { url: string; body: string }[] = [];
  const fake: FetchLike = async (url, init) => {
    calls.push({ url, body: String(init.body) });
    return { ok: true, status: 200 };
  };
  const ok = await sendAlert("https://hooks.example/x", buildAlert("e", "m"), fake);
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hooks.example/x");
  const parsed = JSON.parse(calls[0].body);
  assert.equal(parsed.event, "e");
  assert.equal(parsed.service, "ares1-backend");
});

test("sendAlert is a no-op without a URL and swallows network errors", async () => {
  let called = 0;
  const failing: FetchLike = async () => {
    called += 1;
    throw new Error("network down");
  };
  assert.equal(await sendAlert("", buildAlert("e", "m"), failing), false);
  assert.equal(called, 0);
  assert.equal(await sendAlert("https://hooks.example/x", buildAlert("e", "m"), failing), false);
  assert.equal(called, 1);
  const http500: FetchLike = async () => ({ ok: false, status: 500 });
  assert.equal(await sendAlert("https://hooks.example/x", buildAlert("e", "m"), http500), false);
});
