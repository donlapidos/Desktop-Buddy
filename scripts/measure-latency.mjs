// Ask-to-pointer timing from a timing log: count, median and p90 of each part, per model, typed and spoken apart.
//   npm run measure:latency                     the owner's log (%APPDATA%\desktop-buddy\timing.log and its .old)
//   npm run measure:latency -- --file <path>    another log
import fs from "node:fs";
import path from "node:path";
import { LATENCY_FIELDS, summarizeLatency } from "../src/latency.js";

const args = process.argv.slice(2);
const at = args.indexOf("--file");
const own = path.join(process.env.APPDATA ?? "", "desktop-buddy", "timing.log");
const files = at >= 0 ? [path.resolve(args[at + 1])] : [own.replace(/\.log$/, ".old.log"), own];
const lines = files.filter((f) => fs.existsSync(f)).flatMap((f) => fs.readFileSync(f, "utf8").split(/\r?\n/));
if (!lines.length) {
  console.error(`No timing log at ${files.join(" or ")}.`);
  process.exit(1);
}
const groups = summarizeLatency(lines);
if (!groups.length) {
  console.log("No first-pointer entries yet: ask Buddy something it answers by pointing, then run this again.");
  process.exit(0);
}
const s = (/** @type {number | null} */ ms) => (ms == null ? "-" : `${(ms / 1000).toFixed(2)} s`);
for (const g of groups) {
  console.log(`\n${g.model} · ${g.voice ? "spoken" : "typed"} · ${g.count} question${g.count === 1 ? "" : "s"}`);
  console.log(`  ${"part".padEnd(13)}${"n".padStart(5)}${"median".padStart(10)}${"p90".padStart(10)}`);
  for (const f of LATENCY_FIELDS) {
    const v = g.fields[f];
    if (v.count) console.log(`  ${f.padEnd(13)}${String(v.count).padStart(5)}${s(v.median).padStart(10)}${s(v.p90).padStart(10)}`);
  }
}
