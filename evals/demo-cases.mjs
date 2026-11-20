// The launch demo (docs/DEMO.md), replayed on the windows recorded along its route (scripts/record-tour.mjs, plan
// "pivot"): a made-up sales export, a pivot table built step by step, the answer, and a one-page summary in Word.
// Run it several times before recording: npm run eval -- --provider <id> --model <id> --set demo
import fs from "node:fs";
import { inOrder, shown } from "../src/evals.js";

const win = (/** @type {string} */ name) => JSON.parse(fs.readFileSync(new URL(`./windows/${name}.json`, import.meta.url), "utf8")).tree;
const home = win("excel-sales-home");
const final = win("excel-pivot-final");

/** @typedef {import("../src/evals.js").Call} Call */

/**
 * Passes when Buddy showed Insert, then PivotTable, then (in any order) OK, Region, Revenue and Quarter. The screen
 * recorded after Quarter already has Revenue in Values (that's the order it was recorded in), so Quarter shown
 * before Revenue lands where there's nothing left for Revenue to do: then Revenue isn't required.
 */
export const pivotRoute = (/** @type {Call[]} */ calls) => {
  const start = inOrder(/^insert$/, /^pivottable$/)(calls);
  if (start) return start;
  const names = shown(calls);
  const after = names.slice(names.findIndex((n) => /^pivottable$/.test(n)) + 1);
  const quarterFirst = after.findIndex((n) => /^quarter$/.test(n)) >= 0 && !after.slice(0, after.findIndex((n) => /^quarter$/.test(n))).some((n) => /^revenue$/.test(n));
  const needed = [/^ok$/, /^region$/, /^quarter$/, ...(quarterFirst ? [] : [/^revenue$/])];
  for (const p of needed) if (!after.some((n) => p.test(n))) return `didn't show one matching ${p} after PivotTable (showed ${names.join(", ")})`;
  return null;
};

/** Passes when the answer names West, the region that grew, and nothing was done to the sheet. */
export const namesWest = (/** @type {Call[]} */ calls, /** @type {string} */ reply) =>
  calls.some((c) => c.kind === "act") ? "it acted when asked a question" : /\bwest\b/i.test(reply) ? null : `didn't name West: ${reply.slice(0, 160)}`;

/** Passes when Buddy made one Word document that tells the story with the pivot's numbers, and touched nothing else. */
export const summaryMade = (/** @type {Call[]} */ calls) => {
  const done = calls.filter((c) => c.kind === "act" || (c.kind === "file" && c.name !== "read_file"));
  if (done.length) return `it did something else: ${done.map((c) => `${c.kind} ${c.name}`).join(", ")}`;
  const docs = calls.filter((c) => c.name === "create_document");
  if (docs.length !== 1) return `made ${docs.length} documents, not 1`;
  const text = `${docs[0].input?.title ?? ""}\n${docs[0].input?.markdown ?? ""}`;
  if (!/\bwest\b/i.test(text)) return "the summary doesn't mention West";
  if (!/136[,.]?\d{3}|136(\.\d)?\s?k|\$?136\b/i.test(text)) return "the summary doesn't give West's last quarter (136,479)";
  return null;
};

const NEXT = /** @type {[RegExp, any][]} */ ([
  [/^insert$/, win("excel-sales-insert")],
  [/^pivottable$/, win("excel-pivot-dialog")],
  [/^ok$/, win("excel-pivot-empty")],
  [/^region$/, win("excel-pivot-region")],
  [/^revenue$/, win("excel-pivot-revenue")],
  // Ticked or dragged, Quarter ends up across the top.
  [/^quarter$/, final],
]);

/** @type {import("../src/evals.js").EvalCase[]} */
export const DEMO_CASES = [
  {
    id: "demo-pivot-guide", title: "Demo: build a pivot table, then read it", app: "EXCEL.EXE", strict: true, window: home, next: NEXT,
    ask: "Which region grew the most from Q1 to Q4? Show me how, with a pivot table.",
    check: pivotRoute,
    followUps: [{ window: final, ask: "So which one grew the most?", check: namesWest }],
  },
  {
    id: "demo-pivot-summary", title: "Demo: a one-page summary in Word", app: "EXCEL.EXE", strict: true, window: final,
    ask: "Turn this into a one-page summary for my boss in Word.",
    check: summaryMade,
  },
];
