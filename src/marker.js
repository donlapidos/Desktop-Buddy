// Marker: highlight things on screen with a pen, then ask about them. Marking draws on a still of the screen in an
// opaque window (like the Snipping Tool): drawing straight on the transparent overlay meant Windows repainted the
// whole screen for every stroke segment, which lagged. What the user marked waits here for their question.
import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import { elementsAt, windowsAt } from "./desktop.js";
import { asDipPoint, asDipRect } from "./geometry.js";
import { prepareMarker } from "./marker-startup.js";

/** @typedef {import("./geometry.js").DipPoint} DipPoint */
/** @typedef {import("./geometry.js").DipRect} DipRect */
/** @typedef {import("./geometry.js").PhysicalPoint} PhysicalPoint */
/** @typedef {import("./geometry.js").PhysicalRect} PhysicalRect */
/**
 * What the user marked, waiting for their question: the still with their strokes, the window under them, and each
 * mark's bounds and the elements under it.
 * @typedef {{ image: string, target: any, marks: { n: number, bounds: PhysicalRect, elements: any[] }[] }} PendingMarks
 */

/** @param {DipPoint[]} points @returns {DipRect} */
function bboxOf(points, pad = 10) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return asDipRect({ x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y });
}

const dedupe = (els) => [...new Map(els.map((e) => [e.path, e])).values()];
const markLabel = (m) => {
  const e = m.elements.find((x) => x.name) ?? m.elements[0];
  const text = String(e?.name || e?.value || e?.role || "an area");
  return text.length > 28 ? text.slice(0, 26) + "…" : text;
};

/**
 * @param {{
 *   here: string,
 *   mode: () => import("./modes.js").Mode,
 *   enter: (next: import("./modes.js").Mode) => boolean,
 *   ready: () => boolean,                                   // there is a Brain to ask
 *   summon: () => void,                                     // open the bubble instead (no Brain yet)
 *   marked: () => void,                                     // the tour's "marked" step
 *   hideBubble: () => void,
 *   showAsk: (about: { window: any, point: DipPoint }, marks: { n: number, label: string }[]) => void, // the bubble, ready for the question
 *   progress: (text: string) => void,
 *   notice: (text: string) => void,
 *   keepIsland: () => void,
 *   grabDisplay: (display: Electron.Display, signal: AbortSignal) => Promise<Electron.NativeImage>,
 *   cursor: () => DipPoint,
 *   overlay: (displayId: number) => Electron.BrowserWindow | undefined,
 *   cleared: () => void,                                    // the marks went: tell the overlays and the Brain
 *   toPhysicalPoint: (p: DipPoint) => PhysicalPoint,
 *   toPhysicalRect: (r: DipRect) => PhysicalRect,
 *   ownPids: () => number[],
 *   explain: (at: DipPoint) => void,                        // a single click explains the thing clicked
 *   trace: (entry: object) => void,
 * }} deps
 */
export function createMarker(deps) {
  const { here, mode, enter, progress, notice, trace } = deps;
  /** @type {{ n: number, displayId: number, points: DipPoint[], bbox: DipRect }[]} */
  let marks = [];
  /** @type {PendingMarks | null} */
  let pendingMarks = null;
  /** @type {Electron.BrowserWindow | null} the freeze-frame of the screen the user draws on */
  let markWin = null;
  /** @type {Electron.Display | null} */
  let markDisplay = null;
  let markStartup = null;

  async function start({ capture = deps.grabDisplay, display = screen.getDisplayNearestPoint(deps.cursor()), timeoutMs = 10000 } = {}) {
    if (mode() !== "idle") return;
    if (!deps.ready()) return deps.summon();
    clear();
    enter("marking");
    deps.marked();
    deps.hideBubble();
    progress("Getting the screen ready…");
    markDisplay = display;
    const job = { abort: new AbortController(), started: Date.now(), display, ready: false, readyTimer: null };
    markStartup = job;
    globalShortcut.register("Escape", cancel);
    try {
      const win = new BrowserWindow({
        ...display.bounds,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        backgroundColor: "#000000",
        webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false },
      });
      markWin = win;
      win.setAlwaysOnTop(true, "screen-saver");
      win.on("closed", () => {
        if (markWin === win) cancel();
      });
      const prepared = await prepareMarker({
        capture: async (signal) => { const shot = await capture(display, signal); if (signal.aborted) throw signal.reason; return shot.toPNG(); },
        load: () => win.loadFile(path.join(here, "ui/marker.html")),
        signal: job.abort.signal,
        timeoutMs,
      });
      if (markStartup !== job || job.abort.signal.aborted || mode() !== "marking" || win.isDestroyed()) return;
      trace({ kind: "mark-startup", captureMs: prepared.captureMs, loadMs: prepared.loadMs, totalMs: prepared.totalMs });
      job.readyTimer = setTimeout(() => {
        if (markStartup !== job || job.ready) return;
        stop(); enter("idle"); notice("The screen took too long. Try Mark again.");
      }, Math.max(1, timeoutMs - (Date.now() - job.started)));
      win.webContents.send("mark-start", { png: prepared.image });
    } catch (err) {
      if (markStartup !== job || job.abort.signal.aborted) return;
      stop();
      enter("idle");
      notice(`Couldn't start marking: ${err.message}`);
    }
  }

  // Takes the still down; the caller decides what mode comes next.
  // `delay` keeps the still up a moment so the overlay can paint the finished marks underneath first.
  function stop(delay = 0) {
    const startup = markStartup;
    markStartup = null;
    clearTimeout(startup?.readyTimer);
    startup?.abort.abort();
    globalShortcut.unregister("Return");
    globalShortcut.unregister("Escape");
    const win = markWin;
    markWin = null;
    if (win && !win.isDestroyed()) setTimeout(() => win.isDestroyed() || win.destroy(), delay);
  }

  function clear() {
    marks = [];
    pendingMarks = null;
    deps.cleared();
  }

  function cancel() {
    if (mode() !== "marking") return;
    stop();
    clear();
    enter("idle");
  }

  /** @param {{ image?: unknown, strokes?: unknown }} [result] what marker.html sent: untrusted, checked below */
  async function finish({ image, strokes } = {}) {
    if (mode() !== "marking" || !markDisplay) return;
    const display = markDisplay;
    const valid = (Array.isArray(strokes) ? strokes : []).filter((s) => Array.isArray(s?.points) && s.points.length).slice(0, 50);
    if (!valid.length || typeof image !== "string") return cancel();

    // Hand the marks to the overlay so they stay on screen, then let the still go.
    const overlay = deps.overlay(display.id);
    marks = valid.map((s, i) => {
      const local = s.points.slice(0, 4000).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      overlay?.webContents.send("mark-drawn", { points: local, n: i + 1 });
      const points = local.map((p) => asDipPoint({ x: display.bounds.x + p.x, y: display.bounds.y + p.y }));
      return { n: i + 1, displayId: display.id, points, bbox: bboxOf(points) };
    });
    stop(90);
    enter("reading-marks");
    progress("Reading what you marked…");
    try {
      // Sample each stroke at its start, middle and end, and read the elements under those points.
      const samples = marks
        .flatMap((m) => [m.points[0], m.points[Math.floor(m.points.length / 2)], m.points.at(-1)])
        .map(deps.toPhysicalPoint);
      const wins = await windowsAt(samples, deps.ownPids());
      const groups = new Map();
      samples.forEach((p, i) => {
        if (!wins[i]) return;
        if (!groups.has(wins[i].id)) groups.set(wins[i].id, { win: wins[i], idx: [] });
        groups.get(wins[i].id).idx.push(i);
      });
      const found = new Array(samples.length).fill(null);
      await Promise.all(
        [...groups.values()].map(async ({ win, idx }) => {
          const els = await elementsAt(win, idx.map((i) => samples[i]));
          idx.forEach((i, j) => (found[i] = els[j]));
        }),
      );

      pendingMarks = {
        image,
        target: wins.find(Boolean) ?? null,
        marks: marks.map((m, i) => ({
          n: m.n,
          bounds: deps.toPhysicalRect(m.bbox),
          elements: dedupe(found.slice(i * 3, i * 3 + 3).filter(Boolean)),
        })),
      };
      const last = marks.at(-1).bbox;
      enter("idle");
      deps.showAsk(
        { window: pendingMarks.target, point: asDipPoint({ x: last.x + last.width, y: last.y + last.height }) },
        pendingMarks.marks.map((m) => ({ n: m.n, label: markLabel(m) })),
      );
    } catch (err) {
      enter("idle");
      clear();
      notice("Couldn't read the marks: " + err.message);
    }
  }

  // The still's messages are taken only from the still.
  const fromMarker = (e) => markWin && e.sender === markWin.webContents;
  ipcMain.on("mark-ready", (e) => {
    if (!fromMarker(e) || mode() !== "marking" || !markStartup || markStartup.abort.signal.aborted) return;
    markStartup.ready = true;
    clearTimeout(markStartup.readyTimer);
    trace({ kind: "mark-ready", ms: Date.now() - markStartup.started });
    markWin.show();
    markWin.setBounds(markDisplay.bounds); // Windows clamps oversized windows to the work area on create
    markWin.focus();
    deps.keepIsland();
    progress("Click to explain · draw to ask");
    // Backups in case Windows refuses the still keyboard focus.
    globalShortcut.register("Return", () => markWin?.webContents.send("mark-command", "done"));
    globalShortcut.register("Escape", cancel);
  });
  ipcMain.on("mark-count", (e, n) => {
    if (fromMarker(e)) progress(n ? `${n} marked · Enter to ask` : "Click to explain · draw to ask");
  });
  ipcMain.on("mark-finish", (e, result) => {
    if (fromMarker(e)) finish(result);
  });
  ipcMain.on("mark-cancel", (e) => fromMarker(e) && cancel());
  // A single click in mark mode (before anything is drawn) explains the thing clicked.
  ipcMain.on("mark-click", (e, local) => {
    if (!fromMarker(e) || !local) return;
    const dip = asDipPoint({ x: markDisplay.bounds.x + Number(local.x), y: markDisplay.bounds.y + Number(local.y) });
    stop();
    enter("working");
    progress("Looking at that…");
    // Let the still close before the screen is captured for the explainer.
    setTimeout(() => deps.explain(dip), 120);
  });

  return {
    start, stop, clear, cancel,
    /** What the user marked, still waiting for their question. */
    pending: () => pendingMarks,
    /** What the user marked, handed to the question that uses it. */
    takePending: () => {
      const taken = pendingMarks;
      pendingMarks = null;
      return taken;
    },
    window: () => markWin,
    display: () => markDisplay,
  };
}
