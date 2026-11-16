import assert from "node:assert/strict";
import { test } from "node:test";
import { setBrainDefaults } from "../src/brain.js";
import { inOrder, rescoreEvals, runEvals } from "../src/evals.js";
import { ReplayDesktop } from "../src/eval-replay.js";
import { useCapsStore } from "../src/providers.js";
import { WORKFLOW_CASES } from "../evals/workflow-cases.mjs";

const one = (id) => WORKFLOW_CASES.filter((c) => c.id === `workflow-${id}`);
const ref = (tree, name, role) => {
  for (const node of new ReplayDesktop(tree).nodes().values()) if (node.name === name && (!role || node.role === role)) return node.ref_id;
  throw new Error(`Fixture has no ${name} (${role ?? "any role"})`);
};
const tool = (name, input) => ({ name, input });
const point = (tree, name, role) => tool("point_at", { ref: ref(tree, name, role), caption: name, then_say: `That's ${name}.` });
const sortStep = { target: "Sort...", role: "button", caption: "Open Sort", done_when: ["Sort by"] };

async function scripted(script, cases, options = {}, inspect = () => {}) {
  const realFetch = globalThis.fetch;
  const sent = [];
  setBrainDefaults({ model: "claude-opus-5-5", effort: "low", providerModels: { custom: "scripted" } });
  useCapsStore({}, () => {});
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const next = script[sent.length - 1];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next(init);
    assert.ok(next, "the runner made an unexpected model call");
    const delta = typeof next === "string" ? { content: next } : { tool_calls: [{ index: 0, id: `call${sent.length}`, type: "function", function: { name: next.name, arguments: JSON.stringify(next.input) } }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: typeof next === "string" ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
  };
  try {
    const result = await runEvals({ provider: "custom", apiKey: "", baseURL: "http://scripted.test/v1", cases, ...options });
    inspect(sent, result);
    return result;
  } finally {
    globalThis.fetch = realFetch;
    setBrainDefaults({ model: "claude-opus-5-5", effort: "medium" });
  }
}

test("the strict recorded workflow suite passes valid routes, corrections and honest recovery", async () => {
  const [sort, correction, fresh, browser, missing, unverified] = WORKFLOW_CASES;
  const result = await scripted([
    tool("guide_steps", { steps: [{ target: "Data", role: "tab", caption: "Open Data", done_when: ["Sort..."] }, sortStep], then_say: "The Sort dialog is open." }),
    point(correction.window, "Name Box", "textfield"), point(correction.window, "Formula Bar"),
    point(fresh.window, "Data", "tab"), point(fresh.followUps[0].window, "Sort Z to A"),
    point(browser.window, "Search", "link"),
    "I can't see a Download report button in this view. Which report are you trying to download?",
    tool("guide_steps", { steps: [sortStep], then_say: "The dialog is open." }),
    "It hasn't opened yet. Are you stuck on the Sort button?",
  ], WORKFLOW_CASES, {}, (sent) => {
    assert.match(sent[2].messages.at(-1).content, /Actually, I meant the Formula Bar/);
    assert.match(sent[4].messages.at(-1).content, /Sort Z to A/);
    assert.match(sent[8].messages.at(-1).content, /timed out/);
  });
  assert.equal(result.passed, 6, JSON.stringify(result.results.map((r) => [r.id, r.problem])));
  assert.equal(result.results.reduce((n, r) => n + r.stages.length, 0), 8);
  assert.equal(result.results[0].turns, 1, "a verified complete route still closes without another call");
  assert.equal(result.results[5].turns, 2, "unverified progress cannot use the success closing line");
  assert.equal(typeof result.results[0].stages[0].firstGuidanceMs, "number");
  assert.equal(result.results[4].stages[0].firstGuidanceMs, null);
  assert.equal(typeof result.results[4].stages[0].firstTextMs, "number");
});

test("invented guide targets cannot pass or produce a successful closing line", async () => {
  const result = await scripted([
    tool("guide_steps", { steps: [{ target: "Invented Download Report", caption: "Here", done_when: [] }], then_say: "Done." }), "Done.",
  ], one("browser-missing"), {}, (sent) => assert.match(sent[1].messages.at(-1).content, /nothing on screen/));
  assert.equal(result.passed, 0);
  assert.ok(result.results[0].calls.some((c) => c.name === "missing-control"));
  assert.ok(!result.results[0].calls.some((c) => c.kind === "guide"));
});

test("a correction is scored independently and repeating the old target fails", async () => {
  const c = one("excel-correction")[0];
  const result = await scripted([point(c.window, "Name Box", "textfield"), point(c.window, "Name Box", "textfield")], [c]);
  assert.equal(result.passed, 0);
  assert.match(result.results[0].problem, /Request 2/);
  assert.equal(result.results[0].stages[0].problem, null);
});

test("refs from the previous screen cannot point into the next one", async () => {
  const c = one("excel-fresh-refs")[0];
  const result = await scripted([point(c.window, "Data", "tab"), point(c.window, "Data", "tab"), "There."], [c]);
  assert.equal(result.passed, 0);
  assert.match(result.results[0].problem, /stale or invented ref/);
  assert.equal(result.results[0].stages[1].calls.filter((call) => call.kind === "point").length, 0);
});

test("unchanged screens and already-present text never verify completion", async () => {
  const c = one("excel-unverified")[0];
  const replay = new ReplayDesktop(c.window, c.next);
  replay.point(ref(c.window, "Sort..."));
  assert.equal(replay.progress(["Data"]).status, "timeout", "existing text is not new evidence");
  const result = await scripted([tool("guide_steps", { steps: [sortStep], then_say: "Opened." }), "The Sort dialog is open."], [c]);
  assert.equal(result.passed, 0);
  assert.match(result.results[0].problem, /without acknowledging/);
});

test("ambiguous, disabled and offscreen controls do not become valid targets", () => {
  const node = (id, states = []) => ({ ref_id: id, name: "Save", role: "button", bounds: { x: 1, y: 2, width: 3, height: 4 }, states });
  const replay = new ReplayDesktop({ children: [node("one"), node("two"), node("hidden", ["offscreen"]), node("disabled", ["disabled"])] });
  assert.ok(replay.match("Save").candidates);
  assert.equal(replay.point("hidden"), null);
  assert.equal(replay.point("disabled"), null);
  assert.equal(replay.point("invented"), null);
});

test("one control cannot satisfy two ordered route steps", () => {
  assert.notEqual(inOrder(/sort/, /sort/)([{ kind: "guide", name: "Sort" }]), null);
});

test("provider failure cannot pass a case that expects no action", async () => {
  const result = await scripted([new Error("offline")], [{ ...one("browser-missing")[0], check: () => null }]);
  assert.equal(result.passed, 0);
  assert.match(result.results[0].problem, /failed|no model response/);
});

test("recovery scoring accepts smart apostrophes without accepting a success claim", () => {
  const missing = one("browser-missing")[0];
  for (const apostrophe of ["'", "\u2019", "\u2018", "\u02bc"]) {
    assert.equal(missing.check([], `I can${apostrophe}t see that button. Which report do you mean?`), null);
    const notOpened = one("excel-unverified")[0];
    const calls = [{ kind: "guide", name: "Sort..." }, { kind: "other", name: "wait-timeout" }];
    assert.equal(notOpened.check(calls, `The Sort dialog hasn${apostrophe}t opened. Were you able to click Sort?`), null);
    assert.notEqual(notOpened.check(calls, "The Sort dialog is open."), null);
  }
});

test("saved replies can be rescored without mutating evidence or clearing execution failures", async () => {
  const cases = one("browser-missing");
  const saved = await scripted(["I can’t see that button. Which report do you mean?"], cases);
  saved.results[0].problem = "old scoring failure";
  saved.results[0].passed = false;
  saved.results[0].stages[0].problem = "old scoring failure";
  const original = JSON.stringify(saved);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail("rescoring must not make model calls");
  try {
    const result = rescoreEvals(saved, cases);
    assert.equal(result.passed, 1);
    assert.equal(result.results[0].ms, saved.results[0].ms);
    assert.equal(JSON.stringify(saved), original);
    const broken = structuredClone(saved);
    broken.results[0].stages[0].problem = "no model response was received";
    assert.equal(rescoreEvals(broken, cases).passed, 0);
    assert.throws(() => rescoreEvals({ results: [] }, cases), /no results/);
    assert.throws(() => rescoreEvals(saved, []), /Unknown/);
    assert.throws(() => rescoreEvals({ results: [saved.results[0], saved.results[0]] }, cases), /duplicate/);
    broken.results[0].stages = [];
    assert.throws(() => rescoreEvals(broken, cases), /Incomplete/);
    broken.results[0].stages = [{ ...saved.results[0].stages[0], ask: "different request" }];
    assert.throws(() => rescoreEvals(broken, cases), /Invalid/);
  } finally { globalThis.fetch = realFetch; }
});

test("timeout and cancellation stop the workflow without advancing to another request", { timeout: 3000 }, async () => {
  const waitForAbort = (init) => new Promise((_resolve, reject) => {
    const stop = () => reject(new DOMException("aborted", "AbortError"));
    if (init.signal.aborted) stop();
    else init.signal.addEventListener("abort", stop, { once: true });
  });
  const c = one("excel-correction");
  const timed = await scripted([waitForAbort], c, { timeoutMs: 25 });
  assert.match(timed.results[0].problem, /took too long/);
  assert.equal(timed.results[0].stages.length, 1);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25);
  try {
    const cancelled = await scripted([waitForAbort], c, { signal: abort.signal });
    assert.match(cancelled.results[0].problem, /cancelled/);
  } finally { clearTimeout(timer); }
});
