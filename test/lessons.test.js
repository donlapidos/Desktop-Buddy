import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Brain } from "../src/brain.js";
import { MAX_LESSONS, appName, cleanLesson, createLessons, lessonsFor, namedControls, parsePick, repairQuestion, repairedStep, searchLessons } from "../src/lessons.js";

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-lessons-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "lessons.json");
};
const SORT = {
  title: "Sort a column from largest to smallest",
  app: "EXCEL.EXE",
  steps: [
    { caption: "Click Data", target: "Data", role: "tab", done_when: ["Sort & Filter"] },
    { caption: "Now Sort Z to A", target: "Sort Largest to Smallest", done_when: ["Sorted"], annotation: { kind: "circle" } },
  ],
};

test("a finished route is kept as a lesson and read back", (t) => {
  const file = temp(t);
  const added = createLessons({ file }).add(SORT);
  assert.ok("lesson" in added);
  const [back] = createLessons({ file }).list();
  assert.equal(back.title, SORT.title);
  assert.equal(back.app, "EXCEL.EXE");
  assert.deepEqual(back.steps, SORT.steps);
  assert.match(back.id, /^[a-f0-9]{12}$/);
});

test("a lesson holds only short words: anything else is dropped, and a step that isn't whole refuses the lesson", () => {
  const l = cleanLesson({ ...SORT, steps: [{ ...SORT.steps[0], caption: `Click\u0007 ${"x".repeat(500)}`, script: "alert(1)", annotation: { kind: "explode" } }] });
  assert.ok(l);
  assert.equal(l.steps[0].caption.length, 120);
  assert.doesNotMatch(l.steps[0].caption, /\u0007/);
  assert.equal(/** @type {any} */ (l.steps[0]).script, undefined);
  assert.equal(l.steps[0].annotation, undefined);
  for (const broken of [{ ...SORT, title: "" }, { ...SORT, app: "" }, { ...SORT, steps: [] }, { ...SORT, steps: [{ caption: "Click", target: "Data" }] }, { ...SORT, steps: [...SORT.steps, null] }]) {
    assert.equal(cleanLesson(broken), null, JSON.stringify(broken).slice(0, 80));
  }
});

test("a lesson file can be shared, and only a lesson file is taken in", (t) => {
  const mine = createLessons({ file: temp(t) });
  const { lesson } = /** @type {any} */ (mine.add(SORT));
  const text = mine.exportText(lesson.id);
  assert.match(text, /"kind": "desktop-buddy-lesson"/);
  const theirs = createLessons({ file: temp(t) });
  const imported = theirs.importText(text);
  assert.ok("lesson" in imported);
  assert.deepEqual(/** @type {any} */ (imported).lesson.steps, SORT.steps);
  assert.notEqual(/** @type {any} */ (imported).lesson.id, lesson.id, "an imported lesson gets its own id");
  assert.match(String(/** @type {any} */ (theirs.importText("{nope")).error), /isn't a Buddy lesson/);
  assert.match(String(/** @type {any} */ (theirs.importText(JSON.stringify({ title: "x" }))).error), /isn't a Buddy lesson/);
  assert.match(String(/** @type {any} */ (theirs.importText(JSON.stringify({ ...JSON.parse(text), version: 2 }))).error), /newer Buddy/);
  assert.match(String(/** @type {any} */ (theirs.importText(JSON.stringify({ ...JSON.parse(text), steps: [] }))).error), /isn.t a lesson Buddy can play/);
});

test("lessons can be deleted, and there's a limit", (t) => {
  const file = temp(t);
  const keep = createLessons({ file });
  for (let i = 0; i < MAX_LESSONS; i++) keep.add(SORT);
  assert.match(String(/** @type {any} */ (keep.add(SORT)).error), /Delete one first/);
  keep.remove(keep.list()[0].id);
  assert.equal(createLessons({ file }).list().length, MAX_LESSONS - 1);
  assert.equal(appName("EXCEL.EXE"), "Excel");
  assert.equal(appName("WindowsTerminal.exe"), "WindowsTerminal");
});

test("playing a lesson follows it with no model call and says how it went in plain words", async () => {
  const b = new Brain({ apiKey: "", status() {}, point: async () => {}, confirm: async () => "deny" });
  b.loop = async () => assert.fail("a lesson never calls the model");
  const steps = /** @type {any} */ (cleanLesson(SORT)).steps;
  const outcomes = [
    [{ kind: "finished" }, /^Done/],
    [{ kind: "stuck", step: 1, why: "missing" }, /step 2 \("Now Sort Z to A"\), "Sort Largest to Smallest" isn't on screen/],
    [{ kind: "stuck", step: 0, why: "several" }, /more than one "Data"/],
    [{ kind: "waiting", step: 0 }, /Still waiting at step 1/],
    [{ kind: "changed", step: 1 }, /changed at step 2/],
    [{ kind: "stopped" }, /^Stopped/],
  ];
  for (const [outcome, said] of outcomes) {
    b.guideSteps = async () => ((b.routeOutcome = outcome), "for the model");
    const r = await b.playLesson(steps, { app_name: "EXCEL.EXE", id: "w-1", title: "Budget.xlsx" });
    assert.match(r.text, said, JSON.stringify(outcome));
    assert.equal(r.done, outcome.kind === "finished");
  }
});

test("the shelf shows the lessons for the app someone is in, newest first, and how many more", () => {
  const step = { caption: "Click Insert", target: "Insert", done_when: ["Table"] };
  const at = (title, app, savedAt) => ({ id: title.toLowerCase().replace(/ /g, "-"), title, app, steps: [step], savedAt });
  const list = [at("Make a table", "EXCEL.EXE", 1), at("Sort by amount", "excel.exe", 5), at("Add a chart", "Excel", 3), at("Bold a heading", "WINWORD.EXE", 9), at("Freeze the top row", "EXCEL.EXE", 4), at("Filter", "C:/Program Files/Office/EXCEL.EXE", 2)];
  const excel = lessonsFor(list, "EXCEL.EXE");
  assert.deepEqual(excel.items.map((l) => l.title), ["Sort by amount", "Freeze the top row", "Add a chart", "Filter"], "however the app is written, newest first");
  assert.equal(excel.more, 1);
  assert.deepEqual(Object.keys(excel.items[0]).sort(), ["id", "title"], "only what the shelf needs");
  assert.deepEqual(lessonsFor(list, "winword.exe").items.map((l) => l.title), ["Bold a heading"]);
  assert.deepEqual(lessonsFor(list, "notepad.exe"), { items: [], more: 0 });
  assert.deepEqual(lessonsFor(list, null), { items: [], more: 0 }, "no window, no shelf");
  assert.deepEqual(lessonsFor(list, "EXCEL.EXE", 10).more, 0);
});

test("lessons can be found by any words of their title or app", () => {
  const step = { caption: "Click Insert", target: "Insert", done_when: ["Table"] };
  const list = [{ id: "a", title: "Make a table", app: "EXCEL.EXE", steps: [step], savedAt: 1 }, { id: "b", title: "Bold a heading", app: "WINWORD.EXE", steps: [step], savedAt: 2 }];
  assert.deepEqual(searchLessons(list, "table").map((l) => l.id), ["a"]);
  assert.deepEqual(searchLessons(list, "  EXCEL   make ").map((l) => l.id), ["a"], "any case, any spacing, every word");
  assert.deepEqual(searchLessons(list, "winword").map((l) => l.id), ["b"]);
  assert.deepEqual(searchLessons(list, "excel bold"), [], "every word must match");
  assert.deepEqual(searchLessons(list, "").map((l) => l.id), ["a", "b"], "nothing typed is everything");
});

test("repairing a step: the AI picks from the controls on screen, and only one of them can come back", (t) => {
  const box = { x: 0, y: 0, width: 10, height: 10 };
  const tree = { role: "window", name: "Book1 - Excel", ref_id: "w", bounds: box, children: [
    { role: "tab", name: "Insert", ref_id: "a", bounds: box },
    { role: "tab", name: "Insert", ref_id: "b", bounds: box },
    { role: "button", name: "Tables", ref_id: "c", bounds: box, children: [{ role: "button", name: "Table", ref_id: "d", bounds: box }] },
    { role: "button", name: "Hidden", ref_id: "e", bounds: box, states: ["offscreen"] },
    { role: "text", name: "", ref_id: "f", bounds: box },
    { role: "button", name: "No place", ref_id: "g" },
  ] };
  const controls = namedControls(tree);
  assert.deepEqual(controls.map((c) => c.name), ["Book1 - Excel", "Insert", "Tables", "Table"], "named, on screen, each once");
  assert.equal(namedControls(tree, 2).length, 2);
  // The answer: a number from the list, and nothing else.
  assert.equal(parsePick('{"pick": 3}', controls.length), 2);
  assert.equal(parsePick('Sure! {"pick": 4} is it.', controls.length), 3, "JSON inside words");
  for (const bad of ['{"pick": null}', '{"pick": 0}', '{"pick": 5}', '{"pick": "Insert"}', '{"pick": 2.5}', "Insert", "", '{"pick": 2'])
    assert.equal(parsePick(bad, controls.length), null, bad);
  // The step keeps its caption and what shows it's done; only its control changes.
  const step = { caption: "Open the table menu", target: "Table menu", role: "button", done_when: ["Create Table"] };
  assert.deepEqual(repairedStep(step, controls[2]), { caption: "Open the table menu", target: "Tables", role: "button", done_when: ["Create Table"] });
  assert.equal(repairedStep(step, { name: "", role: "" }), null, "no name, no step");
  // The question carries the step and the numbered list.
  const q = repairQuestion(step, controls, "EXCEL.EXE");
  assert.match(q, /App: Excel/);
  assert.match(q, /Its control was called: "Table menu" [(]button[)]/);
  assert.match(q, /3[.] "Tables" [(]button[)]/);
  // Kept: the repaired lesson replaces the step, keeps its id and when it was saved, and stays checked.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-repair-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createLessons({ file: path.join(dir, "lessons.json"), now: () => 5 });
  const { lesson } = /** @type {any} */ (store.add({ title: "Make a table", app: "EXCEL.EXE", steps: [step, { caption: "Click OK", target: "OK", done_when: ["Table1"] }] }));
  const fixed = /** @type {any} */ (store.updateStep(lesson.id, 0, /** @type {any} */ (repairedStep(step, controls[2]))));
  assert.equal(fixed.lesson.id, lesson.id);
  assert.equal(fixed.lesson.steps[0].target, "Tables");
  assert.equal(fixed.lesson.steps[1].target, "OK", "the other steps stay");
  assert.equal(createLessons({ file: path.join(dir, "lessons.json") }).get(lesson.id)?.steps[0].target, "Tables", "saved");
  assert.match(String(/** @type {any} */ (store.updateStep(lesson.id, 2, step)).error), /isn't in the lesson/);
  assert.match(String(/** @type {any} */ (store.updateStep("nope", 0, step)).error), /gone/);
  assert.match(String(/** @type {any} */ (store.updateStep(lesson.id, 0, /** @type {any} */ ({ caption: "x", target: "", done_when: [] }))).error), /isn't a step Buddy can play/);
});
