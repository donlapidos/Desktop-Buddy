import assert from "node:assert/strict";
import { test } from "node:test";
import { Brain } from "../src/brain.js";

// The glance taken when the bubble opens stands in for the first read of a question, so the answer doesn't read the
// window twice. Nothing here reaches the desktop: reading and capturing are counted stand-ins.
const target = { id: "w1", app_name: "EXCEL.EXE", title: "Book1" };

function glancing() {
  const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, confirm: async () => "deny", screenContext: () => true });
  const counts = { reads: 0, captures: 0 };
  b.look = async () => `window: Book1 · read ${++counts.reads}`;
  b.screenImage = async () => (counts.captures++, /** @type {any} */ ({ type: "image", source: { type: "base64", media_type: "image/png", data: `img${counts.captures}` } }));
  const ask = () => b.initialContext(target, new AbortController().signal);
  return { b, counts, ask };
}

test("a question typed while the bubble kept focus uses the glance: one read, one capture", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const { b, counts, ask } = glancing();
  b.glance(target);
  t.mock.timers.tick(10_000); // typing
  const ctx = await ask();
  assert.equal(ctx.reading, "window: Book1 · read 1");
  assert.equal(ctx.image?.source.data, "img1");
  assert.deepEqual(counts, { reads: 1, captures: 1 });
});

test("after the user went back to their window, the question reads it again", async () => {
  const { b, counts, ask } = glancing();
  b.glance(target);
  b.staleGlance();
  const ctx = await ask();
  assert.equal(ctx.reading, "window: Book1 · read 2");
  assert.deepEqual(counts, { reads: 2, captures: 2 });
});

test("a glance of another window, or an old one, is not used", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const { b, counts, ask } = glancing();
  b.glance({ ...target, id: "w2" });
  assert.equal((await ask()).reading, "window: Book1 · read 2");
  b.glance(target);
  t.mock.timers.tick(31_000);
  assert.equal((await ask()).reading, "window: Book1 · read 4");
  assert.equal(counts.reads, 4);
});

test("a glance is used once", async () => {
  const { b, counts, ask } = glancing();
  b.glance(target);
  await ask();
  await ask();
  assert.equal(counts.reads, 2);
});

test("guide_steps' first step starts from the last read of the same window only while it's recent, and only once", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const { b } = glancing();
  const res = { ok: true, data: { tree: { role: "window" } } };
  b.lastRead = { id: "w1", at: Date.now(), res };
  assert.equal(b.recentRead({ id: "w2" }), null, "another window");
  b.lastRead = { id: "w1", at: Date.now(), res };
  assert.equal(b.recentRead({ id: "w1" }), res);
  assert.equal(b.recentRead({ id: "w1" }), null, "used once");
  b.lastRead = { id: "w1", at: Date.now(), res };
  t.mock.timers.tick(16_000);
  assert.equal(b.recentRead({ id: "w1" }), null, "too old");
});

test("Talk keeps a recent glance of the same window instead of reading again", () => {
  const { b, counts } = glancing();
  b.glance(target);
  b.glance(target, { keep: true });
  assert.equal(counts.reads, 1);
  b.staleGlance();
  b.glance(target, { keep: true });
  assert.equal(counts.reads, 2);
});
