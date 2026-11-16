import assert from "node:assert/strict";
import { test } from "node:test";
import { Brain } from "../src/brain.js";

// Settings › Agents › Show advanced features decides which tools the model is offered. The lists are held here.
const CORE = ["act", "annotate", "clear_annotations", "guide_steps", "launch_app", "list_windows", "look", "point_at", "prepare_explainer", "read_page", "screenshot", "wait_for_user", "window"];
const ADVANCED = ["create_document", "edit_file", "fetch_page", "list_folder", "read_file", "write_file"];

function brain(advanced) {
  let on = advanced;
  const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, confirm: async () => "deny",
    documentsDir: "C:\\Users\\someone\\Documents\\Buddy", dataDir: "C:\\Users\\someone\\AppData\\Roaming\\desktop-buddy", advanced: () => on });
  return { b, flip: (v) => { on = v; } };
}
const names = (b) => b.tools().map((t) => t.name).sort();

test("without the advanced features the model gets the core tools only", () => {
  const { b } = brain(false);
  assert.deepEqual(names(b), CORE);
  assert.match(b.system(), /Show advanced features/);
  assert.doesNotMatch(b.system(), /Beyond the screen/);
});

test("with them it also gets documents, files and web pages", () => {
  const { b } = brain(true);
  assert.deepEqual(names(b), [...CORE, ...ADVANCED].sort());
  assert.doesNotMatch(b.system(), /are switched off/);
});

test("a Buddy that never says (an older profile, a task, an AI app's) keeps every tool", () => {
  const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, confirm: async () => "deny", documentsDir: "D", dataDir: "E" });
  assert.deepEqual(names(b), [...CORE, ...ADVANCED].sort());
});

test("a hidden tool called anyway does nothing, and the switch works at once", async () => {
  const { b, flip } = brain(false);
  b.abort = new AbortController();
  for (const name of ADVANCED) assert.match(await b.runTool(name, { title: "Report", markdown: "# Hi", path: "x.txt", content: "x" }), /switched off/, name);
  flip(true);
  assert.deepEqual(names(b), [...CORE, ...ADVANCED].sort());
});
