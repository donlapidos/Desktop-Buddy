import assert from "node:assert/strict";
import { test } from "node:test";
import { abortable, prepareMarker } from "../src/marker-startup.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("capture and renderer loading overlap instead of waiting for one another", { timeout: 2000 }, async () => {
  const capture = deferred(), load = deferred();
  const started = [];
  const ready = prepareMarker({ signal: new AbortController().signal,
    capture: async () => { started.push("capture"); return capture.promise; },
    load: async () => { started.push("load"); return load.promise; },
  });
  await tick();
  assert.deepEqual(started, ["capture", "load"]);
  load.resolve();
  await tick();
  capture.resolve("current screen");
  const result = await ready;
  assert.equal(result.image, "current screen");
  assert.ok(result.captureMs >= result.loadMs);
  assert.ok(result.totalMs >= Math.max(result.captureMs, result.loadMs));
});

test("cancellation completes promptly even if capture never responds", { timeout: 2000 }, async () => {
  const abort = new AbortController();
  let captureSignal;
  const ready = prepareMarker({ signal: abort.signal, capture: (signal) => { captureSignal = signal; return new Promise(() => {}); }, load: async () => {} });
  await tick();
  abort.abort();
  await assert.rejects(ready, { name: "AbortError" });
  assert.ok(captureSignal.aborted);
});

test("a pre-cancelled startup starts neither capture nor loading", async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareMarker({ signal: abort.signal, capture: () => assert.fail("capture started"), load: () => assert.fail("load started") }), { name: "AbortError" });
});

test("a failed load cancels its capture and consumes a late rejection", { timeout: 2000 }, async () => {
  const capture = deferred();
  let signal;
  const ready = prepareMarker({ signal: new AbortController().signal,
    capture: (s) => { signal = s; return capture.promise; }, load: async () => { throw new Error("failed to load"); },
  });
  await assert.rejects(ready, /failed to load/);
  assert.ok(signal.aborted);
  capture.reject(new Error("late capture failure"));
  await tick();
});

test("a failed capture cancels a stalled renderer load", { timeout: 2000 }, async () => {
  let signal;
  const ready = prepareMarker({ signal: new AbortController().signal, capture: async () => { throw new Error("capture failed"); },
    load: (s) => { signal = s; return new Promise(() => {}); },
  });
  await assert.rejects(ready, /capture failed/);
  assert.ok(signal.aborted);
});

test("startup has a bounded deadline when both phases stall", { timeout: 2000 }, async () => {
  await assert.rejects(prepareMarker({ signal: new AbortController().signal, timeoutMs: 20,
    capture: () => new Promise(() => {}), load: () => new Promise(() => {}),
  }), { name: "TimeoutError" });
});

test("late work cannot replace a completed cancellation result", { timeout: 2000 }, async () => {
  const gate = deferred(); const abort = new AbortController();
  const result = abortable(() => gate.promise, abort.signal);
  await tick(); abort.abort();
  await assert.rejects(result, { name: "AbortError" });
  gate.resolve("obsolete screen"); await tick();
  await assert.rejects(result, { name: "AbortError" });
});
