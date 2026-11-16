import assert from "node:assert/strict";
import { test } from "node:test";
import { SPOT_BOX, spotRect } from "../src/geometry.js";

// The sample chart window as agent-desktop reported it: bounds 1020 x 799 at (450, 170), captured as 1002 x 790.
const shot = { window: /** @type {any} */ ({ x: 450, y: 170, width: 1020, height: 799 }), width: 1002, height: 790 };
const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test("a spot on the screenshot lands on the same place on screen, measured from the picture's own edges", () => {
  // The blue bar's middle, which the window's tree has at (635.5, 521).
  const r = spotRect({ x: (635.5 - 459) / 1002, y: (521 - 170) / 790 }, shot);
  assert.ok(r);
  assert.equal(r.width, SPOT_BOX);
  assert.ok(Math.abs(center(r).x - 635.5) <= 1 && Math.abs(center(r).y - 521) <= 1, JSON.stringify(r));
});

test("a spot at an edge stays inside the picture; nonsense is refused", () => {
  const r = spotRect({ x: 1, y: 0 }, shot);
  assert.ok(r && r.x + r.width <= 459 + 1002 && r.y >= 170);
  for (const bad of [{ x: 1.2, y: 0.5 }, { x: -0.1, y: 0.5 }, { x: NaN, y: 0 }, null]) assert.equal(spotRect(/** @type {any} */ (bad), shot), null);
  assert.equal(spotRect({ x: 0.5, y: 0.5 }, { ...shot, width: 0 }), null);
});
