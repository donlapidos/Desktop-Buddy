// Records a real window's accessibility tree, the way Buddy reads it when it looks, for the model check (evals.js).
// What could identify someone is replaced with placeholders first (src/scrub.js), and the file shows what was
// replaced, so it can be looked over before it's kept.
//   npm run record -- --list                                       the windows open now
//   npm run record -- --app EXCEL.EXE --window-id <id from --list> --name excel-blank --note "A new blank workbook"
//   --names "Jane Doe,Acme"   more names to hide (the account name and its parts always are)
// Saves evals/windows/<name>.json. Reads only; nothing on the desktop is touched.
import path from "node:path";
import { parseArgs } from "node:util";
import { listWindows } from "../src/desktop.js";
import { scrubText } from "../src/scrub.js";
import { recordWindow, whoToHide } from "./record-lib.mjs";

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
const who = whoToHide(o.names.split(","));

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

try {
  const { record, text } = await recordWindow({ app: o.app, windowId: o["window-id"], name: o.name, note: o.note, who });
  console.log(`Saved ${path.join("evals", "windows", `${o.name}.json`)}: "${record.title}", ${record.refCount} refs${record.complete ? "" : " (partial)"}`);
  console.log(`Replaced: ${Object.keys(record.replaced).length ? Object.entries(record.replaced).map(([k, n]) => `${n} ${k}`).join(", ") : "nothing"}`);
  console.log(`\nWhat Buddy sees (first 25 lines), to look over before keeping it:\n${text.split("\n").slice(0, 25).join("\n")}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
