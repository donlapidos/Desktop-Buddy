import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationLayout, annotationLayouts, annotationRequest, createAnnotationLayer, sameBox } from "../src/annotations.js";
import { Brain, needsGuideInspection, setAgentPolicy } from "../src/brain.js";

const box = { x: 20, y: 30, width: 80, height: 30 };
const window = { id: "w-1", app_name: "sample.exe", pid: 42, bounds: { x: 0, y: 0, width: 800, height: 600 } };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await pause(5); } assert.fail("condition didn't settle"); }

function fixture() {
  const shown = [], cleared = [];
  const b = new Brain({ point: async () => {}, status() {}, confirm: async () => { assert.fail("drawing never needs an input-action approval"); },
    annotate: async (items, context) => { shown.push({ items, context }); return true; }, clearAnnotations: (ms) => cleared.push(ms) });
  b.target = window;
  b.abort = new AbortController();
  for (const [ref, bounds] of [["@s1:e1", box], ["@s1:e2", { ...box, x: 300 }]]) {
    b.bounds.set(ref, bounds);
    b.noteApp({ ref_id: ref }, window.app_name, window);
  }
  b.liveBounds = async (ref) => b.bounds.get(ref);
  return { b, shown, cleared };
}

test("annotation requests accept a bounded vocabulary and preserve labels as text", () => {
  const request = annotationRequest({ caption: "Drag it here", items: [{ kind: "drag", ref: "a", to_ref: "b", label: "<img onerror=bad()>", number: 2, svg: "ignored" }] });
  assert.deepEqual(request.items[0], { kind: "drag", ref: "a", to_ref: "b", label: "<img onerror=bad()>", number: 2 });
  for (const items of [[], Array(7).fill({ kind: "circle", ref: "a" }), [{ kind: "script", ref: "a" }], [{ kind: "drag", ref: "a" }], [{ kind: "circle", ref: "a", number: 100 }], [{ kind: "label", ref: "a", label: "" }]]) assert.throws(() => annotationRequest({ items }));
});

test("drawings use current bounds, keep both endpoints, and detect later movement", { timeout: 2000 }, async () => {
  const { b, shown } = fixture();
  b.bounds.set("@s1:e1", { ...box, x: 50 });
  const result = await b.runTool("annotate", { caption: "Drag it here", items: [{ kind: "drag", ref: "@s1:e1", to_ref: "@s1:e2", label: "From here", number: 1 }] });
  assert.match(result, /^Annotated/);
  assert.equal(shown[0].items[0].bounds.x, 50);
  assert.equal(shown[0].items[0].to.x, 300);
  assert.equal(await shown[0].context.verify(), true);
  b.bounds.set("@s1:e1", { ...box, x: 150 });
  assert.equal(await shown[0].context.verify(), false);
});

test("unknown, offscreen, vanished, unlocatable and cross-window refs never draw", { timeout: 2000 }, async () => {
  for (const how of ["unknown", "offscreen", "gone", "unlocatable", "other-window"]) {
    const { b, shown } = fixture();
    if (how === "unknown") b.bounds.delete("@s1:e1");
    if (how === "offscreen") b.offscreenRefs.add("@s1:e1");
    if (how === "gone") b.liveBounds = async () => "gone";
    if (how === "unlocatable") b.liveBounds = async () => null;
    if (how === "other-window") b.refWindows.set("@s1:e2", { ...window, id: "w-2" });
    const result = await b.drawAnnotations({ items: [{ kind: "arrow", ref: "@s1:e1", to_ref: "@s1:e2" }] });
    assert.doesNotMatch(result, /^Annotated/);
    assert.equal(shown.length, 0, how);
  }
});

test("blocked windows and interrupted anchor lookup never draw", { timeout: 2000 }, async (t) => {
  t.after(() => setAgentPolicy(null));
  const { b, shown } = fixture();
  setAgentPolicy({ rope: "trusted", trustedApps: ["sample"], blockedApps: ["sample"] });
  assert.doesNotMatch(await b.drawAnnotations({ items: [{ kind: "circle", ref: "@s1:e1" }] }), /^Annotated/);
  setAgentPolicy(null);
  b.liveBounds = async () => { b.cancel(); return box; };
  assert.equal(await b.drawAnnotations({ items: [{ kind: "circle", ref: "@s1:e1" }] }), "The user stopped.");
  assert.equal(shown.length, 0);
});

test("layout keeps labels on screen and produces finite paths on negative-origin and small displays", () => {
  for (const kind of ["highlight", "circle", "arrow", "label", "drag"]) {
    for (const bounds of [box, { x: -40, y: 2, width: 100, height: 40 }, { x: 240, y: 180, width: 60, height: 20 }]) {
      const layout = annotationLayout({ kind, bounds, to: { ...box, x: 200 }, label: "A long label that should remain inside the screen" }, 320, 220);
      assert.ok(layout.label.x >= 0 && layout.label.y >= 0);
      assert.ok(layout.label.x + layout.label.width <= 320);
      assert.doesNotMatch(layout.path, /NaN|Infinity/);
    }
  }
  assert.equal(annotationLayout({ kind: "highlight", bounds: { ...box, width: 0 } }, 800, 600), null);
  assert.equal(sameBox(box, { ...box, x: 100 }), false);
});

test("nearby labels are placed without overlapping one another", () => {
  const layouts = annotationLayouts(Array.from({ length: 4 }, (_, i) => ({ kind: "label", bounds: { ...box, x: box.x + i * 5 }, label: `Label ${i + 1}: this explains a nearby control` })), 800, 600);
  for (const [i, a] of layouts.entries()) for (const b of layouts.slice(i + 1)) {
    const overlapX = Math.min(a.label.x + a.label.width, b.label.x + b.label.width) - Math.max(a.label.x, b.label.x);
    const overlapY = Math.min(a.label.y + a.label.height, b.label.y + b.label.height) - Math.max(a.label.y, b.label.y);
    assert.ok(overlapX <= 0 || overlapY <= 0);
  }
});

test("an unrelated screen change does not verify an explicit expected guide result", () => {
  const step = { done_when: ["Details opened"] };
  assert.equal(needsGuideInspection(step, { status: "changed", why: "values" }), true);
  assert.equal(needsGuideInspection(step, { status: "changed", why: "window" }), true);
  assert.equal(needsGuideInspection(step, { status: "appeared" }), false);
  assert.equal(needsGuideInspection({ done_when: [] }, { status: "changed", why: "values" }), false);
});

test("only the owner can clear; old expiry and completion don't erase a replacement", { timeout: 2000 }, async (t) => {
  const events = [];
  const layer = createAnnotationLayer({ draw: (_items, owner) => events.push(owner), erase: () => events.push("clear"), intervalMs: 100, lifetimeMs: 500 });
  t.after(() => layer.clear());
  await layer.show("first", [], {});
  layer.release("first", 20);
  await layer.show("second", [], {});
  layer.clear("first");
  await pause(40);
  assert.equal(layer.owner(), "second");
  assert.deepEqual(events, ["first", "clear", "second"]);
});

test("cancel during slow validation returns promptly and never resurrects the drawing", { timeout: 2000 }, async () => {
  const drawn = [];
  let finish;
  const stop = new AbortController();
  const layer = createAnnotationLayer({ draw: () => drawn.push(true), erase() {} });
  const showing = layer.show("a", [], { signal: stop.signal, validate: () => new Promise((r) => { finish = r; }) });
  await pause(0);
  stop.abort();
  assert.equal(await showing, false);
  finish(true);
  await pause(0);
  assert.deepEqual(drawn, []);
});

test("a superseded pending batch cannot paint after its replacement", { timeout: 2000 }, async (t) => {
  let finish;
  const drawn = [];
  const layer = createAnnotationLayer({ draw: (_items, owner) => drawn.push(owner), erase() {} });
  t.after(() => layer.clear());
  const old = layer.show("old", [], { validate: () => new Promise((resolve) => { finish = resolve; }) });
  await pause(0);
  assert.equal(await layer.show("new", [], {}), true);
  assert.equal(await old, false);
  finish(true);
  await pause(0);
  assert.deepEqual(drawn, ["new"]);
});

test("a window or anchor change clears the layer and stops polling", { timeout: 2000 }, async (t) => {
  let valid = true, calls = 0, erased = 0;
  const layer = createAnnotationLayer({ draw() {}, erase: () => erased++, intervalMs: 5 });
  t.after(() => layer.clear());
  await layer.show("a", [], { validate: async () => { calls++; return valid; } });
  valid = false;
  await until(() => layer.owner() === null);
  const finishedCalls = calls;
  await pause(20);
  assert.equal(calls, finishedCalls);
  assert.equal(erased, 1);
});
