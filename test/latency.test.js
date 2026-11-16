import { test } from "node:test";
import assert from "node:assert/strict";
import { questionTiming, quantile, summarizeLatency } from "../src/latency.js";

const entry = (o) => JSON.stringify({ t: "2026-11-16T10:00:00.000Z", kind: "first-pointer", provider: "anthropic", model: "claude-opus-5-5", voice: false, ...o });

test("the summary gives count, median and p90 of each part, per model, typed and spoken apart", () => {
  const lines = [
    ...[1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000].map((ms, i) => entry({ ms, contextMs: 100 * (i + 1), modelMs: ms / 2, pointMs: 900 })),
    entry({ ms: 4000, contextMs: 500, modelMs: 2000, pointMs: 900, voice: true, heardMs: 300, firstAudioMs: 3500 }),
    entry({ ms: 2500, contextMs: 0, modelMs: 1500, pointMs: 900, provider: "ollama", model: "qwen3" }),
    JSON.stringify({ t: "x", kind: "model", ms: 99999 }),
    "not json",
    "",
  ];
  const groups = summarizeLatency(lines);
  assert.deepEqual(groups.map((g) => [g.model, g.voice, g.count]), [
    ["anthropic/claude-opus-5-5", false, 10],
    ["anthropic/claude-opus-5-5", true, 1],
    ["ollama/qwen3", false, 1],
  ]);
  const typed = groups[0].fields;
  assert.deepEqual(typed.ms, { count: 10, median: 5000, p90: 9000 });
  assert.deepEqual(typed.contextMs, { count: 10, median: 500, p90: 900 });
  assert.deepEqual(typed.pointMs, { count: 10, median: 900, p90: 900 });
  assert.deepEqual(typed.heardMs, { count: 0, median: null, p90: null });
  assert.deepEqual(groups[1].fields.heardMs, { count: 1, median: 300, p90: 300 });
  assert.deepEqual(groups[1].fields.firstAudioMs, { count: 1, median: 3500, p90: 3500 });
});

test("quantile uses the nearest rank", () => {
  assert.equal(quantile([], 0.5), null);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2);
});

/** A clock on made-up time. */
function clock(o = {}) {
  let t = 1000;
  const written = [];
  const timing = questionTiming({ write: (e) => written.push(e), now: () => t, provider: "ollama", model: "scripted", ...o });
  return { timing, written, advance: (ms) => (t += ms) };
}

test("one entry per question, written when the answer ends, with its parts and no text", () => {
  const { timing, written, advance } = clock();
  advance(400);
  timing.add("contextMs", 400);
  advance(1200);
  timing.add("modelMs", 1200);
  advance(900);
  timing.pointed(900);
  timing.add("modelMs", 5000); // after the pointer: not part of it
  timing.pointed(10); // only the first pointer counts
  assert.equal(written.length, 0, "nothing is written before the answer ends");
  timing.finish();
  timing.finish();
  assert.deepEqual(written, [{ kind: "first-pointer", ms: 2500, contextMs: 400, modelMs: 1200, pointMs: 900, voice: false, provider: "ollama", model: "scripted" }]);
});

test("an answer that never pointed leaves no entry", () => {
  const { timing, written } = clock();
  timing.add("modelMs", 2000);
  timing.finish();
  assert.equal(written.length, 0);
});

test("a spoken question starts at the end of speech and records hearing and first sound", () => {
  const { timing, written, advance } = clock({ voice: true, at: 700, heardMs: 300 });
  advance(1800);
  timing.pointed(900);
  timing.finish({ waitForAudio: true });
  assert.equal(written.length, 0, "waits for the first sound");
  advance(400);
  timing.audio();
  assert.deepEqual(written, [{ kind: "first-pointer", ms: 2100, contextMs: 0, modelMs: 0, pointMs: 900, voice: true, provider: "ollama", model: "scripted", heardMs: 300, firstAudioMs: 2500 }]);
});

test("a spoken answer that never makes a sound is still written, without firstAudioMs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { timing, written } = clock({ voice: true, at: 1000, heardMs: 250 });
  timing.pointed(900);
  timing.finish({ waitForAudio: true });
  assert.equal(written.length, 0);
  t.mock.timers.tick(10_000);
  assert.equal(written.length, 1);
  assert.equal(written[0].firstAudioMs, undefined);
  assert.equal(written[0].heardMs, 250);
});
