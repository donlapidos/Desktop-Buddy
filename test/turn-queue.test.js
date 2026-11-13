import assert from "node:assert/strict";
import { test } from "node:test";
import { createTurnQueue } from "../src/turn-queue.js";

test("a correction waits for cancellation cleanup, and only the latest pending correction runs", { timeout: 5000 }, async () => {
  const events = [];
  let finish;
  let started;
  const running = new Promise((r) => { started = r; });
  const q = createTurnQueue({ stop: () => { events.push("cancel"); finish?.(); } });
  const first = q.run(async (current) => {
    events.push("first");
    started();
    await new Promise((r) => { finish = r; });
    assert.equal(current(), false);
    events.push("cleanup");
    return { reply: "old" };
  });
  await running;
  const second = q.run(async () => { events.push("second"); return { reply: "second" }; });
  const third = q.run(async () => { events.push("third"); return { reply: "new" }; });
  assert.deepEqual(await first, { reply: null, superseded: true });
  assert.deepEqual(await second, { reply: null, superseded: true });
  assert.deepEqual(await third, { reply: "new" });
  assert.ok(events.indexOf("cleanup") < events.indexOf("third"));
  assert.ok(!events.includes("second"));
});

test("Stop drops pending questions, and a failed answer doesn't block the next one", { timeout: 5000 }, async () => {
  const q = createTurnQueue({ stop() {} });
  const skipped = q.run(async () => { assert.fail("a stopped pending question must not run"); });
  q.cancel();
  assert.deepEqual(await skipped, { reply: null, superseded: true });
  await q.settled();
  await assert.rejects(q.run(async () => { throw new Error("broken"); }), /broken/);
  assert.deepEqual(await q.run(async () => ({ reply: "recovered" })), { reply: "recovered" });
});
