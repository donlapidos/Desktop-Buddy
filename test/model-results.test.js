import assert from "node:assert/strict";
import { test } from "node:test";
import { MEASURED, WORKS_WELL_BAR, measured, worksWell } from "../src/model-results.js";

test("the bar for 'works well' is one constant: 90% of tasks passed", () => {
  assert.equal(WORKS_WELL_BAR, 0.9);
  const rows = [{ provider: "x", model: "at-bar", set: "real", passed: 9, total: 10, avgMs: 1, costPerTask: null, at: "2026-11-16" },
    { provider: "x", model: "below", set: "real", passed: 89, total: 100, avgMs: 1, costPerTask: null, at: "2026-11-16" }];
  assert.equal(worksWell("x", "at-bar", null, rows), true);
  assert.equal(worksWell("x", "below", null, rows), false);
});

test("a model's name never earns the mark: only a measured run, here or the user's own check", () => {
  assert.equal(worksWell("anthropic", "claude-opus-5-5", null, []), false);
  assert.equal(worksWell("anthropic", "claude-opus-5-5", { passed: 7, total: 7 }, []), true, "the user's own check counts");
  assert.equal(worksWell("anthropic", "claude-opus-5-5", { passed: 5, total: 7 }, []), false);
  assert.equal(worksWell("anthropic", "claude-opus-5-5", { passed: 0, total: 0 }, []), false);
});

test("results add up across sets, with the newest date", () => {
  const rows = [{ provider: "p", model: "m", set: "real", passed: 20, total: 26, avgMs: 6000, costPerTask: null, at: "2026-11-10" },
    { provider: "p", model: "m", set: "workflows", passed: 6, total: 6, avgMs: 4000, costPerTask: null, at: "2026-11-16" }];
  assert.deepEqual(measured("p", "m", rows), { passed: 26, total: 32, avgMs: 5625, at: "2026-11-16" });
  assert.equal(worksWell("p", "m", null, rows), false, "81% overall is below the bar");
});

test("every recorded result is dated and possible", () => {
  for (const r of MEASURED) {
    assert.match(r.at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isInteger(r.passed) && Number.isInteger(r.total) && r.passed <= r.total && r.total > 0, `${r.provider}/${r.model}`);
  }
});
