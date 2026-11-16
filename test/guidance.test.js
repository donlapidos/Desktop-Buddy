import assert from "node:assert/strict";
import { test } from "node:test";
import { Brain, GUIDANCE_SYSTEM, SYSTEM, TOOLS } from "../src/brain.js";
import { guidanceFor } from "../src/guidance.js";

const brain = () => new Brain({ apiKey: "test", status() {}, point: async () => {}, confirm: async () => "deny" });
const names = (b) => b.tools().map((t) => t.name);

test("ordinary guidance omits the illustrated-figure payload without changing external tools", async () => {
  const b = brain();
  assert.ok(GUIDANCE_SYSTEM.length < SYSTEM.length * 0.65);
  assert.doesNotMatch(b.system(), /\n\nExplaining:/);
  assert.match(b.system(), /latest request takes precedence/);
  assert.ok(names(b).includes("prepare_explainer"));
  assert.ok(!names(b).includes("show_explainer"));
  assert.ok(names(b).includes("act"));
  assert.ok(TOOLS.some((t) => t.name === "show_explainer"));
  assert.ok(!TOOLS.some((t) => t.name === "prepare_explainer"));
  const compactSize = b.system().length + JSON.stringify(b.tools()).length;
  await b.runTool("prepare_explainer", {});
  assert.match(b.system(), /\n\nExplaining:/);
  assert.ok(names(b).includes("show_explainer"));
  assert.ok(!names(b).includes("prepare_explainer"));
  const fullSize = b.system().length + JSON.stringify(b.tools()).length;
  assert.ok(compactSize < fullSize * 0.75, `${compactSize} vs ${fullSize} characters`);
  b.reset();
  assert.ok(!names(b).includes("show_explainer"));
});

test("app hints match executable identities and follow the next request's app", async () => {
  assert.equal(guidanceFor(" EXCEL.EXE ")?.id, "excel");
  assert.equal(guidanceFor("msedge.exe")?.id, "browser");
  assert.equal(guidanceFor("Budget.xlsx - Excel"), null);
  assert.equal(guidanceFor("notexcel.exe"), null);
  const b = brain();
  b.turn = async () => {
    assert.match(b.system(), /For Excel:/);
    assert.doesNotMatch(b.system(), /For Word:/);
    return { content: [{ type: "text", text: "Ready." }], stop_reason: "end_turn" };
  };
  await b.run({ app_name: "EXCEL.EXE" }, "Help");
  b.turn = async () => {
    assert.doesNotMatch(b.system(), /For Excel:/);
    return { content: [{ type: "text", text: "Ready." }], stop_reason: "end_turn" };
  };
  await b.run({ app_name: "notepad.exe" }, "New task");
});

test("the model can load an explainer during a request; Explain starts ready and ordinary requests reset it", async () => {
  const b = brain();
  let turns = 0;
  b.turn = async () => {
    turns++;
    if (turns === 1) {
      assert.ok(!names(b).includes("show_explainer"));
      return { content: [{ type: "tool_use", id: "load", name: "prepare_explainer", input: {} }], stop_reason: "tool_use" };
    }
    assert.ok(names(b).includes("show_explainer"));
    return { content: [{ type: "text", text: "Ready." }], stop_reason: "end_turn" };
  };
  await b.run(null, "Explain a concept");
  assert.equal(turns, 2);
  turns = 0;
  b.turn = async () => {
    turns++;
    assert.ok(names(b).includes("show_explainer"));
    return { content: [{ type: "text", text: "Explained." }], stop_reason: "end_turn" };
  };
  await b.explain({ image: "AA==", tip: { x: 1, y: 2 }, element: null, target: null, question: "What is this?" });
  assert.equal(turns, 1);
  b.turn = async () => {
    assert.ok(!names(b).includes("show_explainer"));
    return { content: [{ type: "text", text: "Here." }], stop_reason: "end_turn" };
  };
  await b.run(null, "Where is Save?");
});

test("a model cannot skip loading the figure instructions by calling an unoffered tool", async () => {
  const b = brain();
  let turns = 0;
  b.turn = async () => ++turns === 1
    ? { content: [{ type: "tool_use", id: "skip", name: "show_explainer", input: {} }], stop_reason: "tool_use" }
    : { content: [{ type: "text", text: "Retry." }], stop_reason: "end_turn" };
  const original = b.runTool.bind(b);
  b.runTool = async (name, input) => {
    assert.notEqual(name, "show_explainer", "unoffered figure must not be rendered");
    return original(name, input);
  };
  await b.run(null, "Help");
  const result = b.messages[2].content[0];
  assert.match(result.content, /prepare_explainer first/);
});
