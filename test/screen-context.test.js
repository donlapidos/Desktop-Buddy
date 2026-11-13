import assert from "node:assert/strict";
import { test } from "node:test";
import { collectScreenContext } from "../src/screen-context.js";
import { Brain, setAgentPolicy } from "../src/brain.js";
import { learnCaps } from "../src/providers.js";

const target = { id: "w-chart", app_name: "EXCEL.EXE", title: "Sample chart", pid: 123 };
const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };
const reading = "window: Sample chart · 1 refs\n@s1:e1 button Sort";
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

function fixture(extra = {}) {
  const seen = [], reads = [], captures = [];
  const b = new Brain({ status() {}, point: async () => {}, confirm: async () => "deny", ...extra });
  b.look = async (input, options = {}) => { reads.push({ input, ...options }); return reading; };
  b.screenImage = async (window, signal) => { captures.push({ window, signal }); return image; };
  b.loop = async () => { seen.push(b.messages.at(-1).content); return "The blue bar is higher."; };
  return { b, seen, reads, captures };
}

test("window text and image are collected in parallel", { timeout: 2000 }, async () => {
  const gate = deferred();
  const started = [];
  const result = collectScreenContext({ signal: new AbortController().signal, includeImage: true,
    read: async () => { started.push("read"); await gate.promise; return reading; },
    capture: async () => { started.push("capture"); return image; },
  });
  await tick();
  assert.deepEqual(started, ["read", "capture"]);
  gate.resolve();
  assert.deepEqual(await result, { reading, image });
});

test("either source can fail without losing the other", { timeout: 2000 }, async () => {
  const common = { signal: new AbortController().signal, includeImage: true };
  const broken = async () => { throw new Error("unavailable"); };
  assert.deepEqual(await collectScreenContext({ ...common, read: broken, capture: async () => image }), { reading: null, image });
  assert.deepEqual(await collectScreenContext({ ...common, read: async () => reading, capture: broken }), { reading, image: null });
});

test("the deadline preserves ready text and cancels a stalled capture", { timeout: 2000 }, async () => {
  let captureSignal;
  const result = await collectScreenContext({ signal: new AbortController().signal, includeImage: true, budgetMs: 25,
    read: async () => reading,
    capture: async (signal) => { captureSignal = signal; return new Promise(() => {}); },
  });
  assert.deepEqual(result, { reading, image: null });
  assert.ok(captureSignal.aborted);
});

test("a question reaches its first model turn with both sources and exact target refs", { timeout: 2000 }, async () => {
  const { b, seen, reads, captures } = fixture();
  await b.ask("Which bar is higher?", target);
  assert.deepEqual(seen[0][0], image);
  assert.match(seen[0][1].text, /@s1:e1 button Sort/);
  assert.match(seen[0][1].text, /Which bar is higher/);
  assert.deepEqual(reads[0].input, { app: "EXCEL.EXE", window_id: "w-chart" });
  assert.deepEqual(captures[0].window, target);
  assert.ok(reads[0].signal instanceof AbortSignal);
  assert.equal(reads[0].windowOnly, true);
});

test("a failed tree is not described as a successful look when only the image is available", { timeout: 2000 }, async () => {
  const { b, seen } = fixture();
  b.look = async () => '{"ok":false,"error":{"code":"TIMEOUT"}}';
  await b.ask("Help", target);
  assert.equal(seen[0][0].type, "image");
  assert.doesNotMatch(seen[0][1].text, /already looked|its refs work/);
});

test("blocking an app while preparation is pending prevents either source from being sent", { timeout: 2000 }, async (t) => {
  t.after(() => setAgentPolicy(null));
  const { b, seen } = fixture();
  const gate = deferred();
  b.screenImage = async () => gate.promise;
  const question = b.ask("Help", target);
  await tick();
  setAgentPolicy({ rope: "ask", trustedApps: [], blockedApps: ["EXCEL"] });
  gate.resolve(image);
  await question;
  assert.equal(typeof seen[0], "string");
  assert.doesNotMatch(seen[0], /@s1:e1/);
});

test("Stop during preparation cancels both readers and makes no model call, even if they finish late", { timeout: 2000 }, async () => {
  const { b, seen } = fixture();
  const tree = deferred(), picture = deferred();
  const signals = [];
  b.look = async (_input, { signal }) => { signals.push(signal); return tree.promise; };
  b.screenImage = async (_target, signal) => { signals.push(signal); return picture.promise; };
  const question = b.ask("Explain this chart", target);
  await tick();
  assert.equal(signals.length, 2);
  b.cancel();
  assert.equal(await question, "Okay, stopped.");
  assert.ok(signals.every((s) => s.aborted));
  tree.resolve(reading);
  picture.resolve(image);
  await tick();
  assert.equal(seen.length, 0);
  assert.equal(b.messages.length, 0);
});

test("a cancelled question never starts preparation", { timeout: 2000 }, async () => {
  const stop = new AbortController();
  stop.abort();
  const fail = async () => { assert.fail("no source should start"); };
  assert.deepEqual(await collectScreenContext({ signal: stop.signal, includeImage: true, read: fail, capture: fail }), { reading: null, image: null });
});

test("missing, minimized, Buddy-owned and blocked windows never trigger automatic screen reads", { timeout: 2000 }, async (t) => {
  setAgentPolicy({ rope: "ask", trustedApps: [], blockedApps: ["KeePass"] });
  t.after(() => setAgentPolicy(null));
  for (const window of [null, { app_name: "EXCEL.EXE" }, { ...target, minimized: true }, { ...target, pid: 999 }, { ...target, app_name: "KeePass.exe" }]) {
    const { b, reads, captures } = fixture({ isOwnWindow: (w) => w.pid === 999 });
    await b.ask("Help", window);
    assert.equal(reads.length, 0);
    assert.equal(captures.length, 0);
  }
});

test("the screenshot setting takes effect immediately, hides the tool and refuses unsolicited calls", { timeout: 2000 }, async () => {
  let enabled = false;
  const { b, seen, reads, captures } = fixture({ screenContext: () => enabled });
  await b.ask("Help", target);
  assert.equal(reads.length, 1);
  assert.equal(captures.length, 0);
  assert.equal(typeof seen[0], "string");
  assert.ok(!b.tools().some((t) => t.name === "screenshot"));
  assert.match(await b.runTool("screenshot", {}), /turned off/);
  enabled = true;
  await b.ask("Now use the picture", target);
  assert.equal(captures.length, 1);
  assert.equal(seen[1][0].type, "image");
});

test("turning screenshots off while capture is pending discards the image", { timeout: 2000 }, async () => {
  let enabled = true;
  const { b, seen } = fixture({ screenContext: () => enabled });
  const gate = deferred();
  b.screenImage = async () => gate.promise;
  const question = b.ask("Help", target);
  await tick();
  enabled = false;
  gate.resolve(image);
  await question;
  assert.equal(typeof seen[0], "string");
  assert.match(seen[0], /No fresh screenshot/);
});

test("text-only and unknown models get text without attempting an automatic capture", { timeout: 2000 }, async () => {
  for (const provider of ["deepseek", "custom"]) {
    const { b, captures, seen } = fixture({ provider });
    await b.ask("Help", target);
    assert.equal(captures.length, 0);
    assert.equal(typeof seen[0], "string");
  }
  const { b, captures } = fixture({ provider: "custom", baseURL: "https://context-test.invalid/v1" });
  b.model = "verified-vision";
  learnCaps(b.ui.baseURL, b.model, { vision: true });
  await b.ask("Help", target);
  assert.equal(captures.length, 1, "a verified custom model can use automatic visual context");
});

test("old, wrong-window and wrong-app previews are cancelled and replaced with a fresh read", { timeout: 2000 }, async () => {
  for (const overrides of [{ at: Date.now() - 3000 }, { id: "other-window" }, { app: "WINWORD.EXE" }]) {
    const { b, reads, seen } = fixture();
    const abort = new AbortController();
    b.preview = { id: target.id, app: target.app_name, at: Date.now(), text: Promise.resolve("window: stale"), abort, ...overrides };
    await b.ask("Help", target);
    assert.ok(abort.signal.aborted);
    assert.equal(reads.length, 1);
    assert.doesNotMatch(seen[0][1].text, /window: stale/);
  }
});

test("fresh same-window previews are reused, and earlier automatic images leave subsequent requests", { timeout: 2000 }, async () => {
  const { b, reads, captures } = fixture();
  b.preview = { id: target.id, app: target.app_name, at: Date.now(), text: Promise.resolve(reading), abort: new AbortController() };
  await b.ask("First question", target);
  assert.equal(reads.length, 0);
  assert.equal(captures.length, 1);
  await b.ask("Follow-up", target);
  assert.equal(reads.length, 1);
  const images = b.messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((c) => c.type === "image") : []);
  assert.equal(images.length, 1);
  assert.match(b.messages[0].content[0].text, /Earlier window screenshot omitted/);
});
