import assert from "node:assert/strict";
import { test } from "node:test";
import { setBrainDefaults } from "../src/brain.js";
import { runEvals } from "../src/evals.js";
import { useCapsStore } from "../src/providers.js";
import { tourTip } from "../src/welcome.js";
import { SHOW_ME_CASES, shownOff } from "../evals/show-me-cases.mjs";

// The tour's "Show me": the first tip offers it, the question carries the note that makes it a show, and the check
// passes only for one named thing pointed at, nothing done, a short reply.

const URL = "http://127.0.0.1:9/v1";
const BOLD = "@s126uxwam51g4g:e65"; // the Bold button in the recorded Excel window
const call = (name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c_${name}`, function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] });
const text = (t) => ({ choices: [{ delta: { content: t }, finish_reason: "stop" }] });
const sse = (chunk) => new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { status: 200 });

/** Runs one case on a scripted model, returning its result and what was sent. */
async function play(c, script) {
  setBrainDefaults({ model: "claude-opus-5-5", effort: "low", providerModels: { custom: "scripted" } });
  useCapsStore({ [`${URL}|scripted`]: { tools: true, vision: false } }, () => {});
  const realFetch = globalThis.fetch;
  const sent = [];
  let i = 0;
  globalThis.fetch = async (_url, init) => (sent.push(JSON.parse(init.body)), sse(script[i++] ?? text("Done.")));
  try {
    const run = await runEvals({ provider: "custom", apiKey: "", baseURL: URL, cases: [c] });
    return { result: run.results[0], sent };
  } finally {
    globalThis.fetch = realFetch;
    setBrainDefaults({ model: "claude-opus-5-5", effort: "medium" });
  }
}

test("the first tour tip offers Show me; the Mark tip doesn't", () => {
  const words = { ask: "Ctrl+Alt+B", mark: "Ctrl+Alt+M", app: "Excel" };
  assert.equal(tourTip("ask", words)?.show, true);
  assert.equal(tourTip("mark", words)?.show, undefined);
});

test("Show me points at one named thing in their window, with the note that makes it a show", async () => {
  const excel = SHOW_ME_CASES.find((c) => c.id === "show-me-excel");
  const good = await play(excel, [call("point_at", { ref: BOLD, caption: "Bold makes text stand out" }), text("That's Bold, for making text stand out. Ask me how to do anything here.")]);
  assert.equal(good.result.passed, true, good.result.problem ?? "");
  assert.match(JSON.stringify(good.sent[0].messages), /They pressed \\"Show me\\" on your first tip/, "the note went with the question");
  // An ordinary question carries no such note.
  const plain = await play({ ...excel, showOff: false }, [call("point_at", { ref: BOLD, caption: "Bold" }), text("That's Bold.")]);
  assert.doesNotMatch(JSON.stringify(plain.sent[0].messages), /pressed \\"Show me\\"/);
});

test("Show me fails when it acts, walks through steps, points at nothing or rambles", async () => {
  const excel = SHOW_ME_CASES.find((c) => c.id === "show-me-excel");
  const acted = await play(excel, [call("act", { action: "click", ref: BOLD }), text("I made it bold.")]);
  assert.match(acted.result.problem ?? "", /did something/);
  const words = await play(excel, [text("I can point at buttons and explain them.")]);
  assert.match(words.result.problem ?? "", /didn't point/);
  const long = "That's Bold. It makes text heavier. You can use it on headings. Or on totals. Ask me anything.";
  assert.match(shownOff([{ kind: "point", name: "Bold", input: { caption: "Bold" } }], long) ?? "", /ran long/);
  assert.match(shownOff([{ kind: "guide", name: "Bold", input: {} }], "Follow me.") ?? "", /walkthrough/);
  assert.match(shownOff([{ kind: "point", name: "spot", input: { caption: "Here" } }], "Here.") ?? "", /no named control/);
});
