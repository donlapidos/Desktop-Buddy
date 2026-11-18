import assert from "node:assert/strict";
import { test } from "node:test";
import { setBrainDefaults } from "../src/brain.js";
import { runEvals } from "../src/evals.js";
import { useCapsStore } from "../src/providers.js";
import { SIGHT_CASES, spotIn } from "../evals/sight-cases.mjs";

const URL = "http://127.0.0.1:9/v1";
const call = (name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] });
const text = (t) => ({ choices: [{ delta: { content: t }, finish_reason: "stop" }] });
const sse = (chunk) => new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { status: 200 });

/** Runs one sight case on a scripted model that can see. */
async function play(id, script) {
  setBrainDefaults({ model: "claude-opus-5-5", effort: "low", providerModels: { custom: "scripted" } });
  useCapsStore({ [`${URL}|scripted`]: { tools: true, vision: true } }, () => {});
  const realFetch = globalThis.fetch;
  const sent = [];
  let i = 0;
  globalThis.fetch = async (_url, init) => (sent.push(JSON.parse(init.body)), sse(script[i++] ?? text("Done.")));
  try {
    const run = await runEvals({ provider: "custom", apiKey: "", baseURL: URL, cases: SIGHT_CASES.filter((c) => c.id === id) });
    return { result: run.results[0], sent };
  } finally {
    globalThis.fetch = realFetch;
    setBrainDefaults({ model: "claude-opus-5-5", effort: "medium" });
  }
}

test("eight sight cases, each a picture with nothing named in its tree", () => {
  assert.equal(SIGHT_CASES.length, 8);
  for (const c of SIGHT_CASES) {
    assert.ok(c.image?.data.length > 1000, c.id);
    assert.deepEqual(c.window.children.map((n) => n.name), [""], `${c.id}: the tree names nothing`);
  }
});

test("pointing inside the box passes and the picture reaches the model; outside, not at all, or acting fails", async () => {
  const remote = SIGHT_CASES.find((c) => c.id === "sight-remote-desktop");
  const hit = await play("sight-remote-desktop", [call("point_at", { spot: { x: 75, y: 70 }, caption: "Here's the Recycle Bin" }), text("Top left.")]);
  assert.equal(hit.result.passed, true, hit.result.problem ?? "");
  assert.ok(JSON.stringify(hit.sent[0].messages).includes(remote.image.data.slice(0, 200)), "the picture went with the question");
  assert.ok(JSON.stringify(hit.sent[0].messages).includes("This picture is 1280 x 800 pixels."), "and its size, so a spot is counted in its pixels");
  assert.match(JSON.stringify(hit.sent[0].tools), /in that picture's pixels from its top left/, "the spot is asked for in pixels");
  const miss = await play("sight-remote-desktop", [call("point_at", { spot: { x: 576, y: 776 }, caption: "Here" }), text("There.")]);
  assert.equal(miss.result.passed, false);
  assert.match(miss.result.problem, /outside the box/);
  const none = await play("sight-remote-desktop", [text("It's at the top left of the remote screen.")]);
  assert.match(none.result.problem, /didn't point/);
});

test("a circle drawn with a spot counts too; acting never does", () => {
  const check = spotIn({ x: 100, y: 100, width: 50, height: 50 });
  assert.equal(check([{ kind: "other", name: "annotate", input: { items: [{ kind: "circle", spot: { x: 120, y: 120 } }] } }], ""), null);
  assert.match(check([{ kind: "point", name: "spot", input: { spot: { x: 120, y: 120 } } }, { kind: "act", name: "x" }], "") ?? "", /acted/);
});
