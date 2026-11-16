import assert from "node:assert/strict";
import { test } from "node:test";
import { appendStrokePoint, MAX_STROKE_POINTS, pointerSamples } from "../src/marker-stroke.js";

test("long strokes keep following the latest tip within a bounded point budget", () => {
  const points = [{ x: 0, y: 0 }];
  for (let i = 1; i < 20000; i++) {
    appendStrokePoint(points, { x: i * 2, y: i % 10 });
    assert.ok(points.length <= MAX_STROKE_POINTS);
  }
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.deepEqual(points.at(-1), { x: 39998, y: 9 });
  assert.ok(points.length > 1000, "the curve retains its sampled shape");
});

test("pointer-up can retain an exact subpixel endpoint without duplicate or invalid samples", () => {
  const points = [{ x: 10, y: 20 }];
  appendStrokePoint(points, { x: 10.5, y: 20.5 });
  assert.equal(points.length, 1);
  appendStrokePoint(points, { x: 10.5, y: 20.5 }, true);
  assert.equal(points.length, 2);
  appendStrokePoint(points, { x: 10.5, y: 20.5 }, true);
  appendStrokePoint(points, { x: NaN, y: 1 }, true);
  assert.equal(points.length, 2);
});

test("empty or absent coalesced events fall back to the actual pointer event", () => {
  const empty = { getCoalescedEvents: () => [] };
  const plain = {};
  const samples = [{ clientX: 1 }, { clientX: 2 }];
  assert.deepEqual(pointerSamples(empty), [empty]);
  assert.deepEqual(pointerSamples(plain), [plain]);
  assert.equal(pointerSamples({ getCoalescedEvents: () => samples }), samples);
});
