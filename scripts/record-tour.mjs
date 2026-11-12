// Records more screens of real apps for the model check: opens made-up sample files in fresh copies of Excel and Word,
// File Explorer on a sample folder, Calculator and Settings, steps through each (other ribbon tabs, a dialog, a menu,
// another page) and records each screen (record-lib.mjs). A development tool, not part of Buddy, so it drives the
// agent-desktop CLI itself; it only ever acts on windows that appeared after it started, in processes it started
// (Explorer: its own window by title), clicks only controls whose name matches exactly, stops at the first step that
// doesn't go as planned, and closes what it opened.
//   npm run record:tour -- --samples <folder with the sample files> [--only excel,word] [--names "Org,Shared library"]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { listWindows, observe, resolveBinary } from "../src/desktop.js";
import { recordWindow, whoToHide } from "./record-lib.mjs";

const { values: o } = parseArgs({ options: { samples: { type: "string" }, only: { type: "string" }, names: { type: "string", default: "" } } });
if (!o.samples || !fs.existsSync(o.samples)) {
  console.error("Usage: npm run record:tour -- --samples <folder> [--only excel,word,explorer,calculator,settings] [--names a,b]");
  process.exit(2);
}
const who = whoToHide(o.names.split(","));
const SESSION = "record-tour";
const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
// Windows paths with backslashes: Explorer and Word don't take forward slashes.
const samples = path.resolve(o.samples);
const sample = (/** @type {string} */ f) => path.join(samples, f);

/**
 * A step clicks a control (exact name, and role if given), or presses keys, then records the window it lands on
 * (`dialog: true` records the newest window of ours instead, then closes it with Escape).
 * `select` picks a list's option by its exact name (a list option doesn't answer the press action a click uses).
 * @typedef {{ click?: string, select?: string, role?: string, record?: string, note?: string, dialog?: boolean, settle?: number }} Step
 * @typedef {{ id: string, app: string, start: () => void, title: RegExp, ours: "process" | "title", steps: Step[] }} Plan
 */
/** @type {Plan[]} */
const PLANS = [
  {
    id: "excel",
    app: "EXCEL.EXE",
    start: () => run("excel.exe", ["/x", sample("Household budget.csv")]),
    title: /^Household budget - Excel/,
    ours: "process",
    steps: [
      { click: "Insert", role: "tab", record: "excel-budget-insert", note: "Sample budget in Excel, Insert tab" },
      { click: "Formulas", role: "tab", record: "excel-budget-formulas", note: "Sample budget in Excel, Formulas tab" },
      { click: "Data", role: "tab", record: "excel-budget-data", note: "Sample budget in Excel, Data tab" },
      { click: "Sort...", role: "button", record: "excel-sort-dialog", dialog: true, note: "Excel's Sort dialog, over the sample budget" },
      { click: "Review", role: "tab", record: "excel-budget-review", note: "Sample budget in Excel, Review tab" },
    ],
  },
  {
    id: "word",
    app: "WINWORD.EXE",
    start: () => run("winword.exe", [sample("Quarterly report.docx")]),
    title: /^Quarterly report - Word/,
    ours: "process",
    steps: [
      { click: "Insert", role: "tab", record: "word-report-insert", note: "Sample report in Word, Insert tab" },
      { click: "Layout", role: "tab", record: "word-report-layout", note: "Sample report in Word, Layout tab" },
      { click: "Review", role: "tab", record: "word-report-review", note: "Sample report in Word, Review tab" },
      { click: "References", role: "tab", record: "word-report-references", note: "Sample report in Word, References tab" },
    ],
  },
  {
    id: "explorer",
    app: "explorer.exe",
    start: () => run("explorer.exe", [samples]),
    // The window is named after the folder it shows: the sample folder, or the photos folder inside it.
    title: new RegExp(`^(${path.basename(samples).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|Holiday photos) - File Explorer`),
    ours: "title",
    steps: [
      // Clicking an item opens it (the press action is a double-click here): a folder opens in the same window.
      { click: "Holiday photos", record: "explorer-photos-folder", note: "File Explorer inside a made-up photos folder (three images)" },
    ],
  },
  {
    id: "calculator",
    app: "CalculatorApp.exe",
    start: () => run("calc.exe", []),
    title: /^Calculator$/,
    ours: "title",
    steps: [
      { click: "Open Navigation", role: "button", record: "calculator-navigation", note: "Calculator with its mode list open" },
    ],
  },
  {
    id: "settings",
    app: "SystemSettings.exe",
    start: () => run("explorer.exe", ["ms-settings:personalization"]),
    title: /^Settings$/,
    ours: "title",
    steps: [
      { record: "settings-personalization", note: "Windows Settings, Personalization" },
      { click: "Accessibility", record: "settings-accessibility", note: "Windows Settings, Accessibility", settle: 1500 },
      { click: "Text size", record: "settings-text-size", note: "Windows Settings, Accessibility > Text size", settle: 1500 },
    ],
  },
];

// Through `start`, which finds Office by its registered name. The line is passed as written: Node's own quoting
// would wrap the quoted paths again, and Excel and Word would open empty.
function run(/** @type {string} */ command, /** @type {string[]} */ args) {
  const line = ["/c", "start", '""', command, ...args.map((a) => (/\s/.test(a) ? `"${a}"` : a))].join(" ");
  spawnSync("cmd.exe", [line], { windowsHide: true, windowsVerbatimArguments: true });
}

// The exact control to click: same name (ignoring case and spaces), and the role if one is given. Several matches
// or none: the step stops rather than guess.
function exact(/** @type {any} */ tree, /** @type {string} */ name, /** @type {string | undefined} */ role) {
  const want = name.trim().toLowerCase();
  const found = [];
  const walk = (/** @type {any} */ n) => {
    if (n.ref_id && String(n.name ?? "").trim().toLowerCase() === want && (!role || String(n.role ?? "").toLowerCase().includes(role)) && !(n.states ?? []).includes("offscreen")) found.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return found.length === 1 ? found[0] : found.length ? `${found.length} controls named "${name}"` : `no control named "${name}"`;
}

// The nearest container above a node that has a ref: the list an option belongs to.
function parentOf(/** @type {any} */ tree, /** @type {any} */ node) {
  let found = null;
  const walk = (/** @type {any} */ n, /** @type {any} */ holder) => {
    if (n === node) found = holder;
    for (const c of n.children ?? []) walk(c, n.ref_id ? n : holder);
  };
  walk(tree, null);
  return found;
}

const cli = (/** @type {string[]} */ args) => {
  const r = spawnSync(resolveBinary(), [...args, "--session", SESSION], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { ok: false, error: { message: r.stderr || "no answer" } };
  }
};

/** Closes one window we opened, by asking it to close (WM_CLOSE). */
function closeWindow(/** @type {any} */ w) {
  const hwnd = Number(String(w.id).replace(/^w-/, ""));
  if (!Number.isFinite(hwnd)) return;
  const ps = `Add-Type -Namespace RT -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'; [void][RT.U]::PostMessage([System.IntPtr]${hwnd}, 0x10, [System.IntPtr]::Zero, [System.IntPtr]::Zero)`;
  spawnSync("powershell", ["-NoProfile", "-Command", ps], { windowsHide: true });
}

const chosen = PLANS.filter((p) => !o.only || o.only.split(",").includes(p.id));
const saved = [];
for (const plan of chosen) {
  console.log(`\n${plan.id}`);
  const before = new Set((await listWindows()).map((w) => String(w.id)));
  const beforePids = new Set((await listWindows()).filter((w) => w.app_name === plan.app).map((w) => w.pid));
  plan.start();
  let main = null;
  for (let i = 0; i < 60 && !main; i++) {
    await wait(500);
    main = (await listWindows()).find((w) => !before.has(String(w.id)) && w.app_name === plan.app && plan.title.test(w.title ?? "")) ?? null;
  }
  if (!main) {
    // Whatever did open is still ours to close: for Office, any window of a process that wasn't running before.
    const strays = (await listWindows()).filter((w) => !before.has(String(w.id)) && w.app_name === plan.app);
    if (plan.ours === "process") for (const pid of new Set(strays.filter((w) => !beforePids.has(w.pid)).map((w) => w.pid))) spawnSync("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true });
    else if (strays.length) console.log(`  new ${plan.app} windows to check by hand: ${strays.map((w) => `${w.id} "${w.title}"`).join(", ")}`);
    console.log("  didn't open as expected; skipped");
    continue;
  }
  // A process-owned app must be a new process, so closing it can't touch anything the user had open.
  if (plan.ours === "process" && beforePids.has(main.pid)) {
    console.log("  opened inside a copy that was already running; left alone");
    continue;
  }
  const ours = (/** @type {any} */ w) => !before.has(String(w.id)) && w.app_name === plan.app && (plan.ours === "process" ? w.pid === main.pid : plan.title.test(w.title ?? ""));
  await wait(2500);
  try {
    for (const step of plan.steps) {
      const now = (await listWindows()).find((w) => String(w.id) === String(main.id));
      if (!now || !ours(now)) throw new Error("its window went away");
      // Once more, from a fresh read, when agent-desktop says it couldn't yet tell the control apart and a retry is safe.
      for (let attempt = 1; step.click || step.select; attempt++) {
        const look = await observe(["snapshot", "--app", plan.app, "--window-id", String(main.id), "-i", "--compact", "--max-depth", "30", "--timeout-ms", "15000"], { timeoutMs: 30_000, session: SESSION });
        if (!look.ok) throw new Error(`couldn't read it: ${JSON.stringify(look.error)}`);
        const name = /** @type {string} */ (step.click ?? step.select);
        const target = exact(look.data.tree, name, step.click ? step.role : "option");
        if (typeof target === "string") throw new Error(target);
        const list = step.select ? parentOf(look.data.tree, target) : null;
        if (step.select && !list?.ref_id) throw new Error(`the list holding "${name}" has no ref`);
        const done = step.select ? cli(["select", list.ref_id, name]) : cli(["click", target.ref_id]);
        if (done.ok) break;
        if (attempt < 2 && done.error?.recovery?.retryable && done.error?.disposition?.retry === "safe") {
          await wait(done.error.recovery.retry_after_ms ?? 500);
          continue;
        }
        throw new Error(`${step.select ? "selecting" : "clicking"} "${name}" failed: ${JSON.stringify(done.error)}`);
      }
      await wait(step.settle ?? 1200);
      if (!step.record) continue;
      let win = main;
      if (step.dialog) {
        const fresh = (await listWindows()).filter((w) => ours(w) && String(w.id) !== String(main.id));
        if (!fresh.length) throw new Error(`"${step.click}" opened no window`);
        win = fresh[0];
      }
      const { record } = await recordWindow({ app: plan.app, windowId: String(win.id), name: step.record, note: step.note, who });
      saved.push(step.record);
      console.log(`  ${step.record}: "${record.title}", ${record.refCount} refs${record.complete ? "" : " (partial)"}, replaced ${JSON.stringify(record.replaced)}`);
      if (step.dialog) {
        cli(["press", "escape", "--app", plan.app, "--window-id", String(win.id)]);
        await wait(800);
      }
    }
  } catch (err) {
    console.log(`  stopped: ${err.message}`);
  } finally {
    for (const w of (await listWindows()).filter(ours).reverse()) closeWindow(w);
    await wait(1500);
    // Excel and Word ask nothing for an unchanged file; one that's still there after being asked is ended, and
    // only because it's the process this script started.
    if (plan.ours === "process") {
      const left = (await listWindows()).some((w) => w.pid === main.pid);
      if (left) spawnSync("taskkill", ["/PID", String(main.pid), "/F"], { windowsHide: true });
    }
  }
}
console.log(`\nRecorded ${saved.length}: ${saved.join(", ")}`);
