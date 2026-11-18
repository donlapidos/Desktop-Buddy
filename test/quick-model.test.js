import assert from "node:assert/strict";
import { test } from "node:test";
import { Brain, setBrainDefaults } from "../src/brain.js";
import { ProviderError } from "../src/providers.js";
import { normalize, update } from "../src/settings.js";

// The quick model (roadmap 5.5): everyday answers in the bubble use it when the user chose one; illustrated
// explanations, and anything it turns out unable to do, use the main model.

/** A Brain whose model calls are recorded: each turn answers with text, or with what `script` says for that call. */
function brain({ quick = "claude-haiku-5-5", script = [] } = {}) {
  setBrainDefaults({ model: "claude-opus-5-5", effort: "medium", providerModels: {} });
  const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, confirm: async () => "deny", quickModel: () => quick });
  /** @type {string[]} */
  const used = [];
  b.screenImage = async () => null;
  b.look = async () => "";
  b.turn = async () => {
    used.push(b.activeModel);
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next ?? { content: [{ type: "text", text: "Ok." }], stop_reason: "end_turn" };
  };
  return { b, used };
}

test("an everyday question uses the quick model, and none is used when the user chose none", async () => {
  const { b, used } = brain();
  await b.ask("Where is Save As?", null);
  assert.deepEqual(used, ["claude-haiku-5-5"]);
  const off = brain({ quick: "" });
  await off.b.ask("Where is Save As?", null);
  assert.deepEqual(off.used, ["claude-opus-5-5"]);
});

test("an illustrated explanation is the main model's, from the start or once the model asks for one", async () => {
  const { b, used } = brain();
  await b.explain({ image: "AAAA", tip: { x: 1, y: 1 }, element: null, target: null });
  assert.deepEqual(used, ["claude-opus-5-5"], "the Explain shortcut");
  const mid = brain({ script: [{ content: [{ type: "tool_use", id: "t1", name: "prepare_explainer", input: {} }], stop_reason: "tool_use" }] });
  await mid.b.ask("Explain how VLOOKUP works", null);
  assert.deepEqual(mid.used, ["claude-haiku-5-5", "claude-opus-5-5"], "the turn after prepare_explainer");
});

test("when the quick model can't do it, the main model takes the rest of the answer", async () => {
  const { b, used } = brain({ script: [new ProviderError("no_tools", 400, "can't use tools")] });
  const reply = await b.ask("Where is Save As?", null);
  assert.equal(reply, "Ok.");
  assert.deepEqual(used, ["claude-haiku-5-5", "claude-opus-5-5"]);
  // Anything else isn't the quick model's fault: it goes to the user as before.
  const other = brain({ script: [new ProviderError("rate_limit", 429, "slow down")] });
  assert.match(await other.b.ask("Where is Save As?", null), /rate limited/);
  assert.deepEqual(other.used, ["claude-haiku-5-5"]);
});

test("a task window's Brain, made without a quick model, always uses the main one", async () => {
  setBrainDefaults({ model: "claude-opus-5-5", effort: "medium", providerModels: {} });
  const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, confirm: async () => "deny" });
  assert.equal(b.activeModel, "claude-opus-5-5");
});

test("the quick model is kept per provider, from Anthropic's list or shaped like a model id, and cleared with \"\"", () => {
  assert.deepEqual(normalize({}).quickModels, {});
  assert.deepEqual(normalize({ quickModels: { anthropic: "claude-haiku-5-5", openai: "gpt-6.1-mini", ollama: "bad id!" } }).quickModels, { anthropic: "claude-haiku-5-5", openai: "gpt-6.1-mini" });
  assert.deepEqual(normalize({ quickModels: { anthropic: "claude-made-up" } }).quickModels, {});
  const set = update(normalize({}), { quickModels: { anthropic: "claude-haiku-5-5" } });
  assert.deepEqual(set.rejected, []);
  const other = update(set.settings, { quickModels: { openai: "gpt-6.1-mini" } });
  assert.deepEqual(other.settings.quickModels, { anthropic: "claude-haiku-5-5", openai: "gpt-6.1-mini" }, "one provider at a time");
  assert.deepEqual(update(other.settings, { quickModels: { anthropic: "" } }).settings.quickModels, { openai: "gpt-6.1-mini" }, "cleared");
  assert.deepEqual(update(set.settings, { quickModels: { anthropic: "claude-made-up" } }).rejected, ["quickModels.anthropic"]);
});
