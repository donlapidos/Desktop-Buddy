import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { addCall, capProblem, createLedger, dollars, fromOpenRouter, moneyWords, noSpend, priceOf, rememberPrice, spendLine, tokensOf, tokenWords } from "../src/costs.js";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("Anthropic counts cache reads and writes apart from input; each is billed at its own rate", () => {
  const t = tokensOf("anthropic", { input_tokens: 1000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2000, output_tokens: 500 });
  assert.deepEqual(t, { fresh: 1000, cached: 50_000, wrote: 2000, out: 500 });
  // Opus 5.5: $4 in, $0.20 cache read, $5 cache write, $20 out, per million.
  near(dollars(t, /** @type {any} */ (priceOf("anthropic", "claude-opus-5-5"))), (1000 * 4 + 50_000 * 0.2 + 2000 * 5 + 500 * 20) / 1e6);
});

test("OpenAI-style providers count cached tokens inside the input, so they aren't billed twice", () => {
  const t = tokensOf("openai", { input_tokens: 10_000, cache_read_input_tokens: 8000, output_tokens: 100 });
  assert.deepEqual(t, { fresh: 2000, cached: 8000, wrote: 0, out: 100 });
});

test("OpenRouter's per-token prices become per-million ones, and a missing cache price falls back to input", () => {
  const p = fromOpenRouter({ prompt: "0.000003", completion: "0.000015" });
  assert.ok(p);
  near(p.in, 3);
  near(p.out, 15);
  near(p.cacheRead, 3);
  assert.equal(fromOpenRouter({ prompt: "", completion: "0.1" }), null);
  rememberPrice("openrouter", "some/model", p);
  assert.deepEqual(priceOf("openrouter", "some/model"), p);
});

test("a model on this PC is free, and one with no known price is said as tokens only", () => {
  const local = addCall(noSpend(), "ollama", "qwen3:8b", { input_tokens: 4000, output_tokens: 200 });
  assert.equal(spendLine(local), "4.2k tokens · free, on this PC");
  const unknown = addCall(noSpend(), "openai", "gpt-6.1-sol", { input_tokens: 900, output_tokens: 100 });
  assert.equal(spendLine(unknown), "1k tokens");
  assert.equal(spendLine(noSpend()), null, "nothing spent, nothing said");
});

test("an answer's calls add up, and a partly unknown price is said as a floor", () => {
  const s = noSpend();
  addCall(s, "anthropic", "claude-sonnet-5-5", { input_tokens: 100_000, output_tokens: 1000 });
  addCall(s, "anthropic", "claude-sonnet-5-5", { input_tokens: 2000, cache_read_input_tokens: 100_000, output_tokens: 1000 });
  near(s.cost, (100_000 * 2 + 1000 * 10 + 2000 * 2 + 100_000 * 0.2 + 1000 * 10) / 1e6);
  assert.equal(spendLine(s), "204k tokens · about $0.24");
  addCall(s, "anthropic", "claude-some-future-model", { input_tokens: 10, output_tokens: 10 });
  assert.match(spendLine(s) ?? "", /at least \$0\.24$/);
});

test("money and tokens are said as people read them", () => {
  assert.equal(moneyWords(0.001), "under a cent");
  assert.equal(moneyWords(0.04), "$0.04");
  assert.equal(moneyWords(12.3), "$12.30");
  assert.equal(tokenWords(850), "850");
  assert.equal(tokenWords(1200), "1.2k");
  assert.equal(tokenWords(12_400), "12k");
  assert.equal(tokenWords(1_250_000), "1.3M");
});

test("the month's total survives a restart and starts again next month", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "buddy-ledger-")), "spend.json");
  let now = new Date(2026, 10, 30, 23, 0);
  const s = addCall(noSpend(), "anthropic", "claude-haiku-5-5", { input_tokens: 1_000_000, output_tokens: 0 });
  createLedger({ file, now: () => now }).add(s);
  const again = createLedger({ file, now: () => now });
  assert.deepEqual(again.month(), { month: "2026-11", cost: 0.1, tokens: 1_000_000, calls: 1, unpriced: 0 });
  now = new Date(2026, 11, 1, 0, 5);
  assert.deepEqual(again.month(), { month: "2026-12", cost: 0, tokens: 0, calls: 0, unpriced: 0 });
  assert.equal(createLedger({ file, now: () => now }).month().cost, 0, "last month's file isn't this month's");
});

test("the cap stops Buddy once the month's spend reaches it, and no cap never does", () => {
  const m = { month: "2026-11", cost: 5, tokens: 1, calls: 1, unpriced: 0 };
  assert.equal(capProblem(m, 0), null);
  assert.equal(capProblem(m, 5.01), null);
  assert.match(capProblem(m, 5) ?? "", /reached your limit of \$5\.00.*Settings › AI & privacy/);
  assert.match(capProblem({ ...m, cost: 9 }, 5) ?? "", /limit/);
});
