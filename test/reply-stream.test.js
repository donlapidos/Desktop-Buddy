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

test("a sentence that completes while Buddy is still speaking is handed over at once, to follow on", { timeout: 5000 }, async () => {
  const handed = [];
  let finish;
  const s = createReplyStream({ display() {}, speak: (t, how) => {
    handed.push([t, how.join]);
    return new Promise((resolve) => { finish = resolve; });
  }, hush() {}, canSpeak: () => true });
  s.receive({ text: "", done: false });
  s.receive({ text: "First. ", done: false });
  s.receive({ text: "First. Second. ", done: false });
  // The first is still playing (its promise hasn't settled), and the second was handed over anyway, joining it.
  assert.deepEqual(handed, [["First.", false], ["Second.", true]]);
  finish();
  s.receive({ text: "", done: false });
  s.receive({ text: "New answer.", done: true });
  assert.deepEqual(handed.at(-1), ["New answer.", false], "a new reply starts afresh");
});

test("cancelling hushes the voice and nothing late is handed over", { timeout: 5000 }, async () => {
  const handed = [];
  let hushes = 0;
  const s = createReplyStream({ display() {}, speak: async (t) => { handed.push(t); }, hush: () => { hushes++; }, canSpeak: () => true });
  s.receive({ text: "", done: false });
  s.receive({ text: "First. ", done: false });
  s.cancel();
  s.receive({ text: "First. Second. Late.", done: true });
  await s.settled();
  assert.deepEqual(handed, ["First."]);
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

test("the same answer's next step carries on speaking; a new answer stops it", { timeout: 5000 }, async () => {
  const handed = [];
  let hushes = 0;
  const s = createReplyStream({ display() {}, speak: async (t, how) => { handed.push([t, how.join]); }, hush: () => { hushes++; }, canSpeak: () => true });
  s.receive({ text: "", done: false });
  s.receive({ text: "I'll open Insert. ", done: false });
  s.receive({ text: "I'll open Insert.", done: true });
  // The model calls a tool, then writes its next step: what it said isn't cut off, and the new words follow on.
  s.receive({ text: "", done: false, next: true });
  assert.equal(hushes, 0, "a step isn't a new answer");
  s.receive({ text: "Now choose Table. ", done: false });
  s.receive({ text: "Now choose Table.", done: true });
  assert.deepEqual(handed, [["I'll open Insert.", false], ["Now choose Table.", true]]);
  assert.ok(s.covers("Now choose Table."), "the last step's text is what's on screen");
  // A new question is a new answer.
  s.receive({ text: "", done: false });
  assert.equal(hushes, 1);
  // A step that comes after Stop doesn't bring the speech back.
  s.cancel();
  s.receive({ text: "", done: false, next: true });
  s.receive({ text: "Late step.", done: true });
  assert.equal(handed.length, 2);
});
