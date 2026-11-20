import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_CASES, namesWest, pivotRoute, summaryMade } from "../evals/demo-cases.mjs";

// The launch demo's checks (docs/DEMO.md), on hand-made calls: what passes and what doesn't.
const show = (/** @type {string[]} */ names) => names.map((name) => ({ kind: /** @type {const} */ ("guide"), name }));

test("the demo's two cases replay recorded windows, the first with a follow-up", () => {
  assert.deepEqual(DEMO_CASES.map((c) => c.id), ["demo-pivot-guide", "demo-pivot-summary"]);
  assert.ok(DEMO_CASES.every((c) => c.strict && c.window));
  assert.match(DEMO_CASES[0].ask, /from Q1 to Q4/, "a question with one meaning, so the model doesn't stop to ask");
});

test("the pivot route needs Insert, PivotTable, then OK, Region, Quarter and (unless Quarter came first) Revenue", () => {
  assert.equal(pivotRoute(show(["Insert", "PivotTable", "OK", "Region", "Revenue", "Quarter"])), null);
  assert.equal(pivotRoute(show(["Insert", "PivotTable", "OK", "Region", "Quarter"])), null, "the screen after Quarter already has Revenue");
  assert.match(pivotRoute(show(["Insert", "PivotTable", "OK", "Region", "Revenue"])) ?? "", /quarter/);
  assert.match(pivotRoute(show(["PivotTable", "Insert", "OK", "Region", "Quarter"])) ?? "", /pivottable/);
  assert.match(pivotRoute([...show(["Insert", "PivotTable", "OK", "Region", "Quarter"]), { kind: "act", name: "OK" }]) ?? "", /acted/);
});

test("the answer must name West; the summary must be one document with West and its last quarter", () => {
  assert.equal(namesWest([], "West grew the most."), null);
  assert.match(namesWest([], "North grew the most.") ?? "", /West/);
  const doc = (markdown) => ({ kind: /** @type {const} */ ("other"), name: "create_document", input: { title: "Summary", markdown } });
  assert.equal(summaryMade([doc("West rose from 38,442 to 136,479.")]), null);
  assert.match(summaryMade([doc("Sales rose.")]) ?? "", /West/);
  assert.match(summaryMade([doc("West grew a lot.")]) ?? "", /136,479/);
  assert.match(summaryMade([doc("West 136,479"), doc("West 136,479")]) ?? "", /2 documents/);
  assert.match(summaryMade([doc("West 136,479"), { kind: "act", name: "Save" }]) ?? "", /something else/);
});

test("the recorder refuses a window showing Office's Document Recovery, which names other files", async () => {
  const { hasRecoveryPane } = await import("../scripts/record-lib.mjs");
  const excel = (/** @type {any[]} */ children) => ({ role: "window", name: "Regional sales - Excel", children });
  assert.equal(hasRecoveryPane(excel([{ role: "dialog", name: "", children: [{ role: "unknown", name: "Document Recovery", children: [{ role: "option", name: "Someone else's work.xlsx" }] }] }])), true);
  assert.equal(hasRecoveryPane(excel([{ role: "tab", name: "Insert" }])), false);
});
