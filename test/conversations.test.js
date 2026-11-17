import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Brain, withEarlier } from "../src/brain.js";
import { KEEP_DAYS, MAX_TASKS, createConversations } from "../src/conversations.js";

const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-conv-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "conversations.json");
};
const said = (q, a) => [{ role: "user", text: q }, { role: "buddy", text: a }];

test("a task's conversation is kept on the PC and read back after a restart", (t) => {
  const file = temp(t);
  createConversations({ file }).save({ id: "t2", n: 2, title: "Budget", target: { app_name: "EXCEL.EXE", title: "Budget.xlsx" }, transcript: said("Sum column B", "Done: it's in B12.") });
  const again = createConversations({ file });
  assert.equal(again.count(), 1);
  const [kept] = again.tasks();
  assert.equal(kept.id, "t2");
  assert.equal(kept.title, "Budget");
  assert.deepEqual(kept.target, { app_name: "EXCEL.EXE", title: "Budget.xlsx" });
  assert.deepEqual(kept.transcript, said("Sum column B", "Done: it's in B12."));
});

test("only words are kept: secret keys are hidden, and long conversations keep their latest lines", (t) => {
  const file = temp(t);
  const keep = createConversations({ file });
  const long = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? "buddy" : "user", text: `line ${i}` }));
  keep.save({ id: "t1", n: 1, title: "", target: null, transcript: [...long, { role: "user", text: "my key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123" }] });
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /sk-ant-api03/, "no key on disk");
  const [kept] = createConversations({ file }).tasks();
  assert.equal(kept.transcript.length, 40);
  assert.equal(kept.transcript.at(-2).text, "line 59");
  assert.match(kept.transcript.at(-1).text, /[secret key hidden]/);
  // Anything else in a line (an image, a tool's result) never gets in.
  keep.save({ id: "t1", n: 1, title: "", target: null, transcript: [{ role: "user", text: "hi", image: "AAAA" }, { role: "tool", text: "x" }] });
  assert.deepEqual(createConversations({ file }).tasks()[0].transcript, [{ role: "user", text: "hi" }]);
});

test("the bubble's conversation comes back only while it would still be remembered", (t) => {
  const file = temp(t);
  let clock = 1_000_000;
  const now = () => clock;
  createConversations({ file, now }).save({ id: "bubble", n: 0, title: "", target: null, transcript: said("Where is Save As?", "In File.") });
  clock += 60_000;
  const back = createConversations({ file, now }).bubble(15 * 60_000);
  assert.deepEqual(back, { transcript: said("Where is Save As?", "In File."), savedAt: 1_000_000 });
  clock += 15 * 60_000;
  assert.equal(createConversations({ file, now }).bubble(15 * 60_000), null);
  assert.equal(createConversations({ file, now }).tasks().length, 0, "the bubble isn't a task");
});

test("old tasks are forgotten, and no more are kept than can be open", (t) => {
  const file = temp(t);
  let clock = 0;
  const now = () => clock;
  const keep = createConversations({ file, now });
  for (let n = 1; n <= MAX_TASKS + 1; n++) {
    clock += 1000;
    keep.save({ id: `t${n}`, n, title: `Task ${n}`, target: null, transcript: said(`q${n}`, `a${n}`) });
  }
  assert.deepEqual(keep.tasks().map((x) => x.id), ["t2", "t3", "t4", "t5", "t6", "t7"], "the oldest went");
  clock += KEEP_DAYS * 86_400_000;
  assert.equal(createConversations({ file, now }).count(), 0, "a week untouched");
});

test("closing a task or forgetting them all leaves nothing on the PC; a damaged file is ignored", (t) => {
  const file = temp(t);
  const keep = createConversations({ file });
  keep.save({ id: "t1", n: 1, title: "", target: null, transcript: said("a", "b") });
  keep.save({ id: "bubble", n: 0, title: "", target: null, transcript: said("c", "d") });
  keep.forget("t1");
  assert.equal(createConversations({ file }).count(), 1);
  keep.clear();
  assert.ok(!fs.existsSync(file));
  fs.writeFileSync(file, "{not json");
  assert.equal(createConversations({ file }).count(), 0);
  fs.writeFileSync(file, JSON.stringify([{ id: "../evil", savedAt: Date.now(), transcript: said("a", "b") }]));
  assert.equal(createConversations({ file }).count(), 0, "only bubble and task ids");
  // A conversation with nothing said yet isn't kept.
  keep.save({ id: "t3", n: 3, title: "", target: null, transcript: [] });
  assert.equal(createConversations({ file }).count(), 0);
});

test("a resumed conversation goes with its first new question, as context, and only that once", async () => {
  const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, confirm: async () => "deny" });
  b.resume(said("How do I sort column B?", "Data, then Sort Z to A."));
  assert.deepEqual(b.transcript(), said("How do I sort column B?", "Data, then Sort Z to A."), "the window shows it again");
  /** @type {any[]} */
  const sent = [];
  b.loop = async () => (sent.push(b.messages[0].content), "Ok.");
  b.screenImage = async () => null;
  b.look = async () => "";
  await b.ask("And undo that?", null);
  const first = JSON.stringify(sent[0]);
  assert.match(first, /before Buddy restarted/);
  assert.match(first, /User: How do I sort column B\?/);
  assert.match(first, /Buddy: Data, then Sort Z to A\./);
  assert.match(first, /And undo that\?/);
  b.messages = [];
  await b.ask("Thanks", null);
  assert.doesNotMatch(JSON.stringify(sent[1]), /before Buddy restarted/, "only the first question carries it");
});

test("the earlier transcript keeps its latest lines when it is long, and works with pictures", () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ role: "user", text: `question number ${i}` }));
  const out = withEarlier(many, "now");
  assert.match(out, /question number 399/);
  assert.doesNotMatch(out, /question number 0\n/);
  assert.ok(out.length < 9000);
  const blocks = withEarlier(said("a", "b"), [{ type: "image", source: {} }, { type: "text", text: "now" }]);
  assert.equal(blocks.length, 3);
  assert.match(blocks[0].text, /User: a\nBuddy: b/);
});
