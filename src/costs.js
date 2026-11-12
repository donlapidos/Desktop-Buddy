// What Buddy's thinking costs on the user's own key: tokens and an estimated price per answer, a running total for the
// month, and an optional monthly cap. Prices are per million tokens, in US dollars. A price is shown only where it's
// known: Anthropic's published rates, OpenRouter's (its model list says them), and nothing at all for a model on this
// PC. Other providers show tokens only, since their prices change and Buddy doesn't guess.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** @typedef {{ in: number, out: number, cacheRead: number, cacheWrite: number }} Price  US dollars per million tokens */

// Anthropic's rates (platform.claude.com pricing, checked 2026-11-12). A cache write is 1.25x the input rate.
/** @type {Readonly<Record<string, Price>>} */
export const ANTHROPIC_PRICES = Object.freeze({
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-1": { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 },
});

// Prices a provider's model list told Buddy (OpenRouter), by provider and model.
/** @type {Map<string, Price>} */
const told = new Map();

/** Remembers a model's price as its provider reports it. @param {string} provider @param {string} model @param {Price} price */
export function rememberPrice(provider, model, price) {
  if ([price.in, price.out].every((n) => Number.isFinite(n) && n >= 0)) told.set(`${provider}\n${model}`, price);
}

/**
 * OpenRouter's /models pricing (dollars per token, as strings) as a Price, or null.
 * @param {{ prompt?: string, completion?: string, input_cache_read?: string, input_cache_write?: string } | undefined} p
 * @returns {Price | null}
 */
export function fromOpenRouter(p) {
  const perM = (/** @type {string | undefined} */ s) => (s == null || s === "" ? NaN : Number(s) * 1e6);
  const price = { in: perM(p?.prompt), out: perM(p?.completion), cacheRead: perM(p?.input_cache_read), cacheWrite: perM(p?.input_cache_write) };
  if (!Number.isFinite(price.in) || !Number.isFinite(price.out)) return null;
  if (!Number.isFinite(price.cacheRead)) price.cacheRead = price.in;
  if (!Number.isFinite(price.cacheWrite)) price.cacheWrite = price.in;
  return price;
}

/**
 * What a model costs: a Price, "free" (it runs on this PC), or null (not known).
 * @param {string} provider @param {string} model @returns {Price | "free" | null}
 */
export function priceOf(provider, model) {
  if (provider === "ollama" || provider === "lmstudio") return "free";
  if (provider === "anthropic") return ANTHROPIC_PRICES[model] ?? null;
  return told.get(`${provider}\n${model}`) ?? null;
}

/** @typedef {{ fresh: number, cached: number, wrote: number, out: number }} Tokens  input split by how it's billed */

/**
 * One model call's tokens, split by how they're billed. Anthropic counts cache reads and writes apart from
 * `input_tokens`; the other providers (through providers.js) put cached tokens inside `input_tokens`.
 * @param {string} provider @param {any} usage @returns {Tokens}
 */
export function tokensOf(provider, usage) {
  const n = (/** @type {any} */ v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const input = n(usage?.input_tokens);
  const cached = n(usage?.cache_read_input_tokens);
  const wrote = n(usage?.cache_creation_input_tokens);
  const fresh = provider === "anthropic" ? input : Math.max(0, input - cached);
  return { fresh, cached, wrote, out: n(usage?.output_tokens) };
}

/** Dollars for some tokens at a price. @param {Tokens} t @param {Price} p */
export const dollars = (t, p) => (t.fresh * p.in + t.cached * p.cacheRead + t.wrote * p.cacheWrite + t.out * p.out) / 1e6;

const total = (/** @type {Tokens} */ t) => t.fresh + t.cached + t.wrote + t.out;

/**
 * What one answer cost, added up over its model calls.
 * @typedef {{ tokens: number, cost: number, priced: boolean, free: boolean }} Spend
 * `priced`: every call had a known price (else `cost` counts only those that did). `free`: all ran on this PC.
 */

/** A fresh tally for one answer. @returns {Spend} */
export const noSpend = () => ({ tokens: 0, cost: 0, priced: true, free: true });

/** Adds one model call to an answer's tally. @param {Spend} s @param {string} provider @param {string} model @param {any} usage */
export function addCall(s, provider, model, usage) {
  const t = tokensOf(provider, usage);
  const price = priceOf(provider, model);
  s.tokens += total(t);
  if (price === "free") return s;
  s.free = false;
  if (price) s.cost += dollars(t, price);
  else s.priced = false;
  return s;
}

/** An amount of money as people read it: "under a cent", "$0.04", "$12.30". @param {number} usd */
export function moneyWords(usd) {
  if (usd <= 0) return "$0.00";
  if (usd < 0.005) return "under a cent";
  return `$${usd.toFixed(2)}`;
}

/** A token count as people read it: "850", "12k", "1.2M". @param {number} n */
export function tokenWords(n) {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

/** What an answer cost, for the bubble's footer, or null when nothing was spent. @param {Spend} s */
export function spendLine(s) {
  if (!s.tokens) return null;
  const tokens = `${tokenWords(s.tokens)} tokens`;
  if (s.free) return `${tokens} · free, on this PC`;
  if (!s.priced) return s.cost > 0 ? `${tokens} · at least ${moneyWords(s.cost)}` : tokens;
  return `${tokens} · about ${moneyWords(s.cost)}`;
}

// ---------- The month's running total, and the cap ----------

/** The month a time falls in, as "2026-11" (local time: the month the user sees on their calendar). */
export const monthOf = (/** @type {Date} */ d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** @typedef {{ month: string, cost: number, tokens: number, calls: number, unpriced: number }} Month */

/**
 * The month's spend, kept in a small file so it survives restarts. A new month starts from nothing.
 * @param {{ file: string, now?: () => Date }} o
 */
export function createLedger({ file, now = () => new Date() }) {
  /** @type {Month} */
  let m = { month: monthOf(now()), cost: 0, tokens: 0, calls: 0, unpriced: 0 };
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved?.month === m.month && [saved.cost, saved.tokens, saved.calls, saved.unpriced].every((n) => Number.isFinite(n) && n >= 0)) m = saved;
  } catch {}
  const current = () => {
    const month = monthOf(now());
    if (m.month !== month) m = { month, cost: 0, tokens: 0, calls: 0, unpriced: 0 };
    return m;
  };
  return {
    /** The month so far. @returns {Month} */
    month: () => ({ ...current() }),
    /** Adds what a model call (or several) spent. @param {Spend} s */
    add(s) {
      if (!s.tokens) return;
      const c = current();
      c.cost += s.cost;
      c.tokens += s.tokens;
      c.calls += 1;
      if (!s.priced) c.unpriced += 1;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${crypto.randomBytes(3).toString("hex")}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(c));
        fs.renameSync(tmp, file);
      } catch {}
    },
  };
}

/**
 * Why Buddy won't think now, or null. A cap of 0 means none. Only spend with a known price counts toward it.
 * @param {Month} m @param {number} cap US dollars
 */
export function capProblem(m, cap) {
  if (!(cap > 0) || m.cost < cap) return null;
  return `This month's spend has reached your limit of ${moneyWords(cap)} (Settings › AI & privacy), so I've stopped. Raise or remove the limit there to carry on, or it resets next month.`;
}
