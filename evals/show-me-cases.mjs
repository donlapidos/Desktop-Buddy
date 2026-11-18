// The tour's "Show me" (welcome.js, brain.js SHOW_OFF): someone's first look at Buddy, on a window recorded from a
// real app (evals/windows/). It passes when Buddy points at one named thing in that window, does nothing to it, and
// says what it is in a sentence or two. Run: npm run eval -- --provider <id> --model <id> --set show-me
import fs from "node:fs";

const win = (/** @type {string} */ name) => JSON.parse(fs.readFileSync(new URL(`./windows/${name}.json`, import.meta.url), "utf8")).tree;

/** @typedef {import("../src/evals.js").Call} Call */

/** Passes when Buddy pointed at one or two named controls with a caption, did nothing, and kept it short. */
export const shownOff = (/** @type {Call[]} */ calls, /** @type {string} */ reply) => {
  const done = calls.filter((c) => c.kind === "act" || c.kind === "file" || c.kind === "service");
  if (done.length) return `it did something: ${done.map((c) => `${c.kind} ${c.name}`).join(", ")}`;
  if (calls.some((c) => c.kind === "guide")) return "it started a walkthrough instead of showing one thing";
  const points = calls.filter((c) => c.kind === "point");
  if (!points.length) return "it didn't point at anything";
  if (points.length > 2) return `it pointed ${points.length} times; one thing is the show`;
  if (points.some((c) => !c.name || c.name === "spot" || !String(c.input?.caption ?? "").trim())) return "a point had no named control or no caption";
  const sentences = reply.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
  if (reply.length > 320 || sentences > 3) return `the reply ran long (${sentences} sentences, ${reply.length} characters)`;
  return null;
};

const ASK = "Show me what you can do";

/** @type {import("../src/evals.js").EvalCase[]} */
export const SHOW_ME_CASES = [
  { id: "show-me-excel", title: "Show me, in an Excel budget", app: "EXCEL.EXE", window: win("excel-budget-home"), ask: ASK, showOff: true, check: shownOff },
  { id: "show-me-calculator", title: "Show me, in Calculator", app: "CalculatorApp.exe", window: win("calculator-standard"), ask: ASK, showOff: true, check: shownOff },
  { id: "show-me-edge", title: "Show me, on a Wikipedia page in Edge", app: "msedge.exe", window: win("edge-wikipedia-article"), ask: ASK, showOff: true, check: shownOff },
];
