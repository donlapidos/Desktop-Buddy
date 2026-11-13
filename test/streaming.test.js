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
    on(event, callback) { assert.equal(event, "text"); emit = callback; return this; },
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
