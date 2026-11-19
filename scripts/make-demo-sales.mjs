// Makes the demo's sample data (docs/DEMO.md): a made-up sales export, 2,000 orders over 2026 in four regions, in
// the order a till system dumps them, not sorted. West grows through the year and the others stay flat, so a pivot
// table by region and quarter shows something worth asking about. Seeded, so the file is the same every time.
//   node scripts/make-demo-sales.mjs [folder]      (default: scripts/samples/demo)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "samples", "demo"));

// A small seeded generator (mulberry32): the same data on every run.
let seed = 20260101;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (/** @type {any[]} */ list) => list[Math.floor(random() * list.length)];

const REGIONS = {
  North: ["Avery Lund", "Jonah Pike"],
  South: ["Maria Ortiz", "Dev Sharma"],
  East: ["Chloe Brandt", "Sam Okafor"],
  West: ["Leo Tran", "Priya Nair"],
};
const PRODUCTS = [["Desk lamp", 39], ["Office chair", 189], ["Standing desk", 449], ["Monitor arm", 79], ["Keyboard", 59], ["Webcam", 95]];
// How a region's orders grow over the year: West climbs steeply, the rest barely move.
const growth = (/** @type {string} */ region, /** @type {number} */ month) => (region === "West" ? 0.55 + month * 0.2 : 1 + (month - 5.5) * 0.01);

const rows = [];
let order = 41000;
for (let month = 0; month < 12; month++) {
  const days = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
  for (const region of Object.keys(REGIONS)) {
    const orders = Math.round(42 * growth(region, month) * (0.9 + random() * 0.2));
    for (let i = 0; i < orders; i++) {
      const [product, price] = pick(PRODUCTS);
      const units = 1 + Math.floor(random() * (product === "Standing desk" ? 3 : 8));
      const day = 1 + Math.floor(random() * days);
      rows.push({ date: `2026-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, region, rep: pick(REGIONS[region]), product, units, price });
    }
  }
}
// Exactly 2,000, shuffled the way an export comes out: by order number, which isn't by date or region.
while (rows.length > 2000) rows.splice(Math.floor(random() * rows.length), 1);
for (let i = rows.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [rows[i], rows[j]] = [rows[j], rows[i]];
}

// Exports often carry the quarter too: it is what a pivot table puts across the top to show growth.
const quarter = (/** @type {string} */ date) => `Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
const lines = ["Order,Date,Quarter,Region,Sales rep,Product,Units,Unit price,Revenue"];
for (const r of rows) lines.push([order++, r.date, quarter(r.date), r.region, r.rep, r.product, r.units, r.price, r.units * r.price].join(","));
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, "Regional sales.csv");
fs.writeFileSync(file, `${lines.join("\r\n")}\r\n`);

// What the pivot table will show, to check the story is there: revenue by region and quarter.
const sums = {};
for (const r of rows) {
  const q = quarter(r.date);
  sums[r.region] ??= { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  sums[r.region][q] += r.units * r.price;
}
console.log(`Wrote ${rows.length} orders to ${file}`);
for (const [region, q] of Object.entries(sums)) console.log(region.padEnd(6), Object.values(q).map((v) => String(Math.round(v / 1000)).padStart(4) + "k").join(" "), ` Q4/Q1 ${(q.Q4 / q.Q1).toFixed(2)}x`);
