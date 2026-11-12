// Records a real window's accessibility tree, the way Buddy reads it when it looks, for the model check (evals.js).
// What could identify someone is replaced with placeholders first (src/scrub.js), and the file shows what was
// replaced, so it can be looked over before it's kept.
//   npm run record -- --list                                       the windows open now
//   npm run record -- --app EXCEL.EXE --window-id <id from --list> --name excel-blank --note "A new blank workbook"
//   --names "Jane Doe,Acme"   more names to hide (the account name and its parts always are)
// Saves evals/windows/<name>.json. Reads only; nothing on the desktop is touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { listWindows, renderTree, snapshotResilient } from "../src/desktop.js";
import { namesToHide, scrubText, scrubTree } from "../src/scrub.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values: o } = parseArgs({
  options: {
    list: { type: "boolean" },
    app: { type: "string" },
    "window-id": { type: "string" },
    name: { type: "string" },
    note: { type: "string", default: "" },
    names: { type: "string", default: "" },
  },
});

const who = {
  names: namesToHide([os.userInfo().username, process.env.USERNAME ?? "", ...o.names.split(",")]),
  pc: os.hostname(),
};

if (o.list) {
  for (const w of await listWindows()) console.log(`${String(w.id).padEnd(10)} ${String(w.app_name).padEnd(28)} ${scrubText(w.title ?? "", who)}`);
  process.exit(0);
}
if (!o.app || !o["window-id"] || !o.name || !/^[a-z0-9-]+$/.test(o.name)) {
  console.error("Usage: npm run record -- --app <app> --window-id <id> --name <lowercase-name> [--note <what's open>] [--names <a,b>]\n       npm run record -- --list");
  process.exit(2);
}
// Only the window asked for, never "whichever is in front": that could be anything the user has open.
const win = (await listWindows()).find((w) => String(w.id) === o["window-id"]);
if (!win || String(win.app_name).toLowerCase() !== o.app.toLowerCase()) {
  console.error(`No ${o.app} window ${o["window-id"]} is open. See npm run record -- --list.`);
  process.exit(1);
}

// The same read as Buddy's look tool (brain.js look): interactive controls, compact, with positions.
const res = await snapshotResilient(["--app", o.app, "--window-id", o["window-id"]], ["-i", "--compact", "--include-bounds"], { timeoutMs: 30_000 });
if (!res.ok) {
  console.error(`Couldn't read the window: ${JSON.stringify(res.error)}`);
  process.exit(1);
}
const tree = scrubTree(res.data.tree, who);
const before = JSON.stringify(res.data.tree);
const after = JSON.stringify(tree);
const replaced = Object.fromEntries(["email", "number", "name", "user", "pc", "path"].map((k) => [k, (after.match(new RegExp(`<${k}>`, "g")) ?? []).length - (before.match(new RegExp(`<${k}>`, "g")) ?? []).length]).filter(([, n]) => n > 0));

let version = null;
try {
  version = JSON.parse(fs.readFileSync(path.join(root, "bin", "agent-desktop.json"), "utf8")).version;
} catch {}
const record = {
  name: o.name,
  app: o.app,
  title: scrubText(res.data.window?.title ?? "", who),
  note: o.note,
  recordedAt: new Date().toISOString().slice(0, 10),
  agentDesktop: version,
  refCount: res.data.ref_count ?? null,
  complete: res.data.complete !== false,
  replaced,
  tree,
};
const dir = path.join(root, "evals", "windows");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${o.name}.json`);
fs.writeFileSync(file, `${JSON.stringify(record, null, 1)}\n`);

const { text } = renderTree(tree);
console.log(`Saved ${path.relative(root, file)}: "${record.title}", ${record.refCount} refs${record.complete ? "" : " (partial)"}`);
console.log(`Replaced: ${Object.keys(replaced).length ? Object.entries(replaced).map(([k, n]) => `${n} ${k}`).join(", ") : "nothing"}`);
console.log(`\nWhat Buddy sees (first 25 lines), to look over before keeping it:\n${text.split("\n").slice(0, 25).join("\n")}`);
