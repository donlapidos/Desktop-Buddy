import assert from "node:assert/strict";
import { test } from "node:test";
import { Brain } from "../src/brain.js";

// Pointing by sight: a spot on the latest screenshot, for things with no control to point at. Nothing reaches the
// desktop here; the screenshot's facts are set as Buddy records them when it sends one.
const win = { id: "w1", app_name: "mspaint.exe", title: "Untitled - Paint", bounds: { x: 450, y: 170, width: 1020, height: 799 } };

function brain({ provider = "anthropic", model } = {}) {
  const seen = { points: [], guesses: [], cards: [], acted: 0 };
  const b = new Brain({ apiKey: "sk-test", provider, status() {}, point: async (r, c) => { seen.points.push({ r, c }); },
    pointGuess: async (r, c, w) => { seen.guesses.push({ r, c, w }); }, confirm: async (...a) => (seen.cards.push(a), "allow") });
  if (model) b.model = model;
  b.performSlip = async () => (seen.acted++, { ok: true });
  b.abort = new AbortController();
  b.target = win;
  b.shot = { window: win, width: 1002, height: 790, at: Date.now() };
  b.bounds.set("@s1:e1", /** @type {any} */ ({ x: 510, y: 734, width: 350, height: 56 }));
  b.refApps.set("@s1:e1", "mspaint.exe");
  return { b, seen };
}

test("act never takes a spot, with or without a ref: it refuses, and no card is shown", async () => {
  const { b, seen } = brain();
  for (const input of [{ action: "click", spot: { x: 0.5, y: 0.5 } }, { action: "click", ref: "@s1:e1", spot: { x: 0.5, y: 0.5 } }, { action: "press", keys: "enter", spot: { x: 0.1, y: 0.1 } }]) {
    assert.match(await b.runTool("act", input), /never on a spot/);
  }
  assert.equal(seen.cards.length, 0, "no approval card");
  assert.equal(seen.acted, 0, "nothing done");
});

test("point_at with a spot shows a best guess in the screenshot's window, measured on the picture", async () => {
  const { b, seen } = brain();
  const reply = await b.runTool("point_at", { spot: { x: (635.5 - 459) / 1002, y: (521 - 170) / 790 }, caption: "The blue bar" });
  assert.match(reply, /best guess/);
  assert.equal(seen.points.length, 0, "not shown as a sure pointer");
  assert.equal(seen.guesses.length, 1);
  const { r, w } = seen.guesses[0];
  assert.ok(Math.abs(r.x + r.width / 2 - 635.5) <= 1 && Math.abs(r.y + r.height / 2 - 521) <= 1, JSON.stringify(r));
  assert.equal(w.id, "w1");
});

test("a spot is refused without a model that sees, or without a recent screenshot", async () => {
  const blind = brain({ provider: "deepseek", model: "deepseek-chat" });
  assert.match(await blind.b.runTool("point_at", { spot: { x: 0.5, y: 0.5 }, caption: "Here" }), /model that can see/);
  const { b, seen } = brain();
  b.shot = null;
  assert.match(await b.runTool("point_at", { spot: { x: 0.5, y: 0.5 }, caption: "Here" }), /no recent screenshot/);
  b.shot = { window: win, width: 1002, height: 790, at: Date.now() - 6 * 60_000 };
  assert.match(await b.runTool("point_at", { spot: { x: 0.5, y: 0.5 }, caption: "Here" }), /no recent screenshot/);
  assert.equal(seen.guesses.length, 0);
});

test("annotate takes a spot for a highlight, circle or label, marked as a guess; not for an arrow or drag", async () => {
  const { b } = brain();
  let drawn = null;
  b.ui.annotate = async (items, context) => ((drawn = { items, context }), true);
  b.canObserveTarget = () => true;
  assert.match(await b.runTool("annotate", { items: [{ kind: "circle", spot: { x: 0.2, y: 0.4 }, label: "This bar" }] }), /^Annotated/);
  assert.equal(drawn.items[0].guess, true);
  assert.equal(drawn.context.window.id, "w1");
  assert.match(await b.runTool("annotate", { items: [{ kind: "arrow", spot: { x: 0.2, y: 0.4 }, to_ref: "@s1:e1" }] }), /need real control refs/);
});
