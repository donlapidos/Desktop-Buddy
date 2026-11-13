import assert from "node:assert/strict";
import { test } from "node:test";
import { createReplyStream } from "../src/reply-stream.js";

test("text arrives immediately; speech waits for a sentence and doesn't repeat the final answer", { timeout: 5000 }, async () => {
  const shown = [], spoken = [];
  const s = createReplyStream({ display: (t) => shown.push(t), speak: async (t) => { spoken.push(t); }, hush() {}, canSpeak: () => true });
  s.receive({ text: "", done: false });
  s.receive({ text: "Select column", done: false });
  await s.settled();
  assert.deepEqual(shown, ["Select column"]);
  assert.deepEqual(spoken, []);
  s.receive({ text: "Select column B. Then", done: false });
  await s.settled();
  assert.deepEqual(spoken, ["Select column B."]);
  s.receive({ text: "Select column B. Then open Data.", done: true });
  await s.settled();
  assert.deepEqual(spoken, ["Select column B.", "Then open Data."]);
  assert.ok(s.covers("Select column B. Then open Data."));
  assert.ok(!s.covers("Okay, stopped."));
});

test("cancelling stops current speech and discards queued and late sentences", { timeout: 5000 }, async () => {
  const spoken = [];
  let finish;
  let hushes = 0;
  const s = createReplyStream({ display() {}, speak: async (t) => {
    spoken.push(t);
    await new Promise((resolve) => { finish = resolve; });
  }, hush: () => { hushes++; finish?.(); }, canSpeak: () => true });
  s.receive({ text: "", done: false });
  s.receive({ text: "First. ", done: false });
  await Promise.resolve();
  s.receive({ text: "First. Second.", done: true });
  const pending = s.settled();
  s.cancel();
  s.receive({ text: "First. Second. Late.", done: true });
  await pending;
  assert.deepEqual(spoken, ["First."]);
  assert.equal(hushes, 1);
  assert.ok(!s.covers("First. Second."));
});

test("silent replies still stream, and decimals and code blocks aren't spoken in fragments", { timeout: 5000 }, async () => {
  const spoken = [], shown = [];
  let enabled = false;
  const s = createReplyStream({ display: (t) => shown.push(t), speak: async (t) => { spoken.push(t); }, hush() {}, canSpeak: () => enabled });
  s.receive({ text: "", done: false });
  s.receive({ text: "A silent answer.", done: true });
  await s.settled();
  assert.deepEqual(shown, ["A silent answer."]);
  assert.deepEqual(spoken, []);
  enabled = true;
  s.receive({ text: "", done: false });
  s.receive({ text: "Use 2.5", done: false });
  await s.settled();
  assert.deepEqual(spoken, []);
  s.receive({ text: "Use 2.5 percent.", done: true });
  await s.settled();
  assert.deepEqual(spoken, ["Use 2.5 percent."]);
  s.receive({ text: "", done: false });
  s.receive({ text: "```js\nrun. ", done: false });
  await s.settled();
  assert.equal(spoken.length, 1);
  s.receive({ text: "```js\nrun. \n```", done: true });
  await s.settled();
  assert.equal(spoken.length, 1);
});
