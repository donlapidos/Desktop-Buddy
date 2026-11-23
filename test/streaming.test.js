import assert from "node:assert/strict";
import { test } from "node:test";
import { chatTurn } from "../src/providers.js";
import { Brain, takeTurn } from "../src/brain.js";

for (const provider of ["openai", "deepseek"]) {
  test(`${provider}: text is delivered before the stream finishes; partial tool arguments stay buffered`, { timeout: 5000 }, async () => {
    const encoder = new TextEncoder();
    let controller;
    const body = new ReadableStream({ start(c) { controller = c; } });
    const put = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
    let first;
    const sawText = new Promise((resolve) => { first = resolve; });
    let finished = false;
    const delta = provider === "openai"
      ? { type: "response.output_text.delta", delta: "Look here." }
      : { choices: [{ index: 0, delta: { content: "Look here.", tool_calls: [{ index: 0, id: "t1", function: { name: "point_at", arguments: '{"ref":' } }] } }] };
    const updates = [];
    const call = chatTurn({ provider, key: "test", model: "stream-test", effort: "low", system: "", tools: [], messages: [], maxTokens: 100,
      fetchImpl: async () => new Response(body), onText: (s) => { updates.push(s); first(); },
    }).then((r) => { finished = true; return r; });
    put(delta);
    await sawText;
    assert.equal(finished, false, "the user sees text while the provider is still generating");
    assert.deepEqual(updates, ["Look here."]);
    if (provider === "openai") put({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "Look here." }] }] } });
    else put({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"@s1:e1"}' } }] }, finish_reason: "tool_calls" }] });
    controller.close();
    const reply = await call;
    assert.equal(reply.content[0].text, "Look here.");
    if (provider !== "openai") assert.deepEqual(reply.content[1].input, { ref: "@s1:e1" });
  });
}

test("Anthropic text streams to the UI before completion, and cancelled streams cannot send late text", { timeout: 5000 }, async () => {
  const updates = [];
  const b = new Brain({ point: async () => {}, confirm: async () => "deny", status() {}, stream: (u) => updates.push(u) });
  let emit;
  let finish;
  b.abort = new AbortController();
  b.anthropic = /** @type {any} */ ({ beta: { messages: { stream: () => ({
    on(event, callback) { if (event === "text") emit = callback; return this; },
    finalMessage: () => new Promise((resolve) => { finish = resolve; }),
  }) } } });
  const running = b.turn();
  emit("Select ");
  emit("Data.");
  assert.deepEqual(updates.at(-1), { text: "Select Data.", done: false });
  b.cancel();
  emit(" Late text.");
  finish({ content: [{ type: "text", text: "Select Data. Late text." }] });
  await running;
  assert.deepEqual(updates.at(-1), { text: "Select Data.", done: false });
});

test("an approved action waiting for another task is discarded when its answer is interrupted", { timeout: 5000 }, async () => {
  let release;
  let locked;
  const ready = new Promise((r) => { locked = r; });
  const held = takeTurn(async () => { locked(); await new Promise((r) => { release = r; }); });
  await ready;
  let confirmed;
  const approved = new Promise((r) => { confirmed = r; });
  const b = new Brain({ point: async () => {}, confirm: async () => { confirmed(); return "allow"; }, status() {} });
  b.abort = new AbortController();
  let acted = false;
  b.performSlip = async () => { acted = true; return { ok: true }; };
  try {
    const action = b.operate({ kind: "click", args: ["click", "@s1:e1"], headed: false, summary: "Click Save" });
    await approved;
    // Let the approved action join the input queue while the other task holds it.
    await new Promise((r) => setImmediate(r));
    b.cancel();
    release();
    assert.equal(await action, "The user stopped.");
    assert.equal(acted, false);
  } finally {
    release();
    await held;
  }
});

/** A Brain on a scripted Anthropic stream: `text` and `event` push into it; `finish` ends the reply. */
function streamedBrain(ui = {}) {
  const seen = { cards: 0, acted: 0, points: [], traces: [] };
  const b = new Brain({ status() {}, confirm: async () => (seen.cards++, "allow"), point: async (bounds, caption) => { seen.points.push(caption); },
    trace: (e) => seen.traces.push(e.kind), ...ui });
  b.performSlip = async () => (seen.acted++, { ok: true });
  b.abort = new AbortController();
  b.bounds.set("@s1:e1", /** @type {any} */ ({ x: 10, y: 20, width: 80, height: 30 }));
  const handlers = {};
  let finish;
  b.anthropic = /** @type {any} */ ({ beta: { messages: { stream: () => ({
    on(event, callback) { handlers[event] = callback; return this; },
    finalMessage: () => new Promise((resolve) => { finish = resolve; }),
  }) } } });
  const running = b.turn();
  const tool = (name, json) => {
    handlers.streamEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name, input: {} } });
    for (let i = 0; i < json.length; i += 7) handlers.streamEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 7) } });
  };
  return { b, seen, running, tool, finish: (reply) => finish(reply) };
}

const tick = () => new Promise((r) => setImmediate(r));

test("a streamed act cut short does nothing and shows no card", { timeout: 5000 }, async () => {
  const { b, seen, running, tool, finish } = streamedBrain();
  // Everything but the closing brace: the action is fully named, and still must not start.
  tool("act", '{"action": "click", "ref": "@s1:e1", "summary": "Click Save", "caption": "Save"');
  await tick();
  b.cancel();
  finish({ content: [{ type: "tool_use", id: "t1", name: "act", input: { action: "click", ref: "@s1:e1" } }], stop_reason: "tool_use" });
  await running;
  await tick();
  assert.deepEqual({ cards: seen.cards, acted: seen.acted, points: seen.points }, { cards: 0, acted: 0, points: [] });
  assert.ok(!seen.traces.includes("early-start"));
});

test("a streamed point_at points before the model has finished its reply", { timeout: 5000 }, async () => {
  const { b, seen, running, tool, finish } = streamedBrain();
  tool("point_at", '{"ref": "@s1:e1", "caption": "Here", "then_say": "There it is, the Save button, at the top of the window."');
  await tick();
  assert.deepEqual(seen.points, ["Here"], "the pointer started while the call was still being written");
  assert.ok(seen.traces.includes("early-start"));
  finish({ content: [{ type: "tool_use", id: "t1", name: "point_at", input: { ref: "@s1:e1", caption: "Here" } }], stop_reason: "tool_use" });
  await running;
  // The finished call uses the pointer already on its way instead of pointing twice.
  b.liveBounds = async () => null;
  assert.equal(await b.runTool("point_at", { ref: "@s1:e1", caption: "Here" }), "Pointed.");
  assert.deepEqual(seen.points, ["Here"]);
});

test("streamed tool arguments reach onToolInput as they arrive, on Chat Completions", { timeout: 5000 }, async () => {
  const encoder = new TextEncoder();
  const heard = [];
  const chunk = (args, name) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...(name ? { id: "c1" } : {}), function: { ...(name ? { name } : {}), arguments: args } }] } }] })}

`;
  const body = new ReadableStream({ start(c) {
    c.enqueue(encoder.encode(chunk('{"steps": [', "guide_steps")));
    c.enqueue(encoder.encode(chunk('{"target": "Insert", "caption": "Click Insert"}')));
    c.enqueue(encoder.encode(chunk("]}")));
    c.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}

data: [DONE]

`));
    c.close();
  } });
  await chatTurn({ provider: "deepseek", key: "k", model: "m", effort: "low", system: "", tools: [], messages: [], maxTokens: 10,
    fetchImpl: async () => new Response(body), onToolInput: (i, name, raw) => heard.push([i, name, raw]) });
  assert.deepEqual(heard.map((h) => h[2]), ['{"steps": [', '{"steps": [{"target": "Insert", "caption": "Click Insert"}', '{"steps": [{"target": "Insert", "caption": "Click Insert"}]}']);
  assert.ok(heard.every((h) => h[0] === 0 && h[1] === "guide_steps"));
});

test("each answer starts the reply stream once; its later steps say they're the same answer", { timeout: 5000 }, async () => {
  const updates = [];
  const b = new Brain({ point: async () => {}, confirm: async () => "deny", status() {}, stream: (u) => updates.push(u) });
  b.anthropic = /** @type {any} */ ({ beta: { messages: { stream: () => ({
    on() { return this; },
    finalMessage: async () => ({ content: [{ type: "text", text: "Done." }] }),
  }) } } });
  b.abort = new AbortController();
  b.stepped = false; // what run() sets at the start of an answer
  await b.turn();
  await b.turn();
  const starts = updates.filter((u) => u.text === "" && !u.done);
  assert.deepEqual(starts.map((u) => !!u.next), [false, true]);
});
