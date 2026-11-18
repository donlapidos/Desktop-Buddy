import assert from "node:assert/strict";
import { test } from "node:test";
import { SPOT_BOX, modelPictureSize, spotRect } from "../src/geometry.js";

// The sample chart window as agent-desktop reported it: bounds 1020 x 799 at (450, 170), captured as 1002 x 790.
const shot = { window: /** @type {any} */ ({ x: 450, y: 170, width: 1020, height: 799 }), width: 1002, height: 790 };
const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test("a spot on the screenshot lands on the same place on screen, measured from the picture's own edges", () => {
  // The blue bar's middle, which the window's tree has at (635.5, 521).
  const r = spotRect({ x: 635.5 - 459, y: 521 - 170 }, shot);
  assert.ok(r);
  assert.equal(r.width, SPOT_BOX);
  assert.ok(Math.abs(center(r).x - 635.5) <= 1 && Math.abs(center(r).y - 521) <= 1, JSON.stringify(r));
});

test("a spot at an edge stays inside the picture; nonsense is refused", () => {
  const r = spotRect({ x: 1002, y: 0 }, shot);
  assert.ok(r && r.x + r.width <= 459 + 1002 && r.y >= 170);
  for (const bad of [{ x: 1003, y: 5 }, { x: -1, y: 5 }, { x: 5, y: 791 }, { x: NaN, y: 0 }, null]) assert.equal(spotRect(/** @type {any} */ (bad), shot), null);
  assert.equal(spotRect({ x: 500, y: 400 }, { ...shot, width: 0 }), null);
});

test("a spot on a shrunk picture is counted in that picture's pixels and lands on the same place", () => {
  const half = { ...shot, seen: { width: 501, height: 395 } };
  const r = spotRect({ x: (635.5 - 459) / 2, y: (521 - 170) / 2 }, half);
  assert.ok(r && Math.abs(center(r).x - 635.5) <= 1.5 && Math.abs(center(r).y - 521) <= 1.5, JSON.stringify(r));
  assert.equal(spotRect({ x: 600, y: 100 }, half), null, "past the edge of what the model saw");
});

test("a window picture goes at a size no provider shrinks again, keeping its shape, never enlarged", () => {
  for (const [w, h] of [[3840, 2160], [2560, 1600], [3200, 2400], [1080, 1920], [5120, 1440]]) {
    const s = modelPictureSize(w, h);
    assert.ok(Math.max(s.width, s.height) <= 1568 && Math.min(s.width, s.height) <= 768 && s.width * s.height <= 1_150_000, `${w}x${h} -> ${s.width}x${s.height}`);
    assert.ok(Math.abs(s.width / s.height - w / h) < 0.01 * (w / h), `${w}x${h} keeps its shape`);
  }
  assert.deepEqual(modelPictureSize(3200, 2400), { width: 1024, height: 768 });
  assert.deepEqual(modelPictureSize(1000, 700), { width: 1000, height: 700 }, "small enough already");
});
