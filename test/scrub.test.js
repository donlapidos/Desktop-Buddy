import assert from "node:assert/strict";
import { test } from "node:test";
import { namesToHide, scrubText, scrubTree } from "../src/scrub.js";

const who = { names: namesToHide(["JaneDoe", "Jane Doe"]), pc: "JANE-LAPTOP" };

test("email addresses, phone and account numbers become placeholders", () => {
  assert.equal(scrubText("Reply to jane.doe+work@example.co.uk now", who), "Reply to <email> now");
  assert.equal(scrubText("Call +63 917 555 0134 or (02) 8123-4567", who), "Call <number> or <number>");
  assert.equal(scrubText("Account 123456789012", who), "Account <number>");
});

test("ordinary numbers in an app are left alone", () => {
  assert.equal(scrubText("Font Size 11", who), "Font Size 11");
  assert.equal(scrubText("Page 1 of 3", who), "Page 1 of 3");
  assert.equal(scrubText("Zoom 100%", who), "Zoom 100%");
  assert.equal(scrubText("2026-11-12", who), "2026-11-12");
  assert.equal(scrubText("Due 12/11/2026", who), "Due 12/11/2026");
  assert.equal(scrubText("Version 1.2.0", who), "Version 1.2.0");
});

test("a web address keeps its site and loses what it asked for", () => {
  assert.equal(scrubText("https://mail.example.com/inbox/id/AAQk?x=1", who), "https://mail.example.com/<path>");
  assert.equal(scrubText("Go to https://en.wikipedia.org/wiki/Spreadsheet.", who), "Go to https://en.wikipedia.org/<path>");
  assert.equal(scrubText("https://example.com", who), "https://example.com");
});

test("the user's folder, their names and the PC's name are hidden", () => {
  assert.equal(scrubText("C:\\Users\\JaneDoe\\Documents\\Budget.xlsx", who), "C:\\Users\\<user>\\Documents\\Budget.xlsx");
  assert.equal(scrubText("Signed in as Jane Doe", who), "Signed in as <name>");
  assert.equal(scrubText("Jane's PC JANE-LAPTOP", who), "<name>'s PC <pc>");
  assert.equal(scrubText("Doe, Jane", who), "<name>, <name>");
});

test("a name's short parts and ordinary words aren't hidden", () => {
  const hide = namesToHide(["AlDo"]);
  assert.deepEqual(hide, ["AlDo"]);
  assert.equal(scrubText("Undo", { names: hide }), "Undo");
  assert.equal(scrubText("Janet", who), "Janet", "a name inside another word stays");
});

test("a tree keeps its shape, roles, refs and positions; only its text is scrubbed", () => {
  const tree = {
    role: "window",
    name: "Inbox - jane@example.com - Outlook",
    children: [
      { role: "button", name: "Jane Doe", ref_id: "@s1:e1", bounds: { x: 1, y: 2, width: 3, height: 4 }, states: ["focusable"] },
      { role: "edit", name: "To", value: "bob@example.com", ref_id: "@s1:e2" },
    ],
  };
  assert.deepEqual(scrubTree(tree, who), {
    role: "window",
    name: "Inbox - <email> - Outlook",
    children: [
      { role: "button", name: "<name>", ref_id: "@s1:e1", bounds: { x: 1, y: 2, width: 3, height: 4 }, states: ["focusable"] },
      { role: "edit", name: "To", value: "<email>", ref_id: "@s1:e2" },
    ],
  });
  assert.equal(tree.children[0].name, "Jane Doe", "the original isn't changed");
});
