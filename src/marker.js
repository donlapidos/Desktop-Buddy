// Marker: highlight things on screen with a pen, then ask about them. Live first: the user draws on a native overlay
// over their running apps (marker-live.js), which hands Windows only the few pixels each pen move changes. If that
// can't start, on a still of the screen in an opaque window (like the Snipping Tool): drawing straight on a
// transparent Electron window made Windows repaint the whole screen for every stroke segment, which lagged. What the
// user marked waits here for their question.
import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import { elementsAt, windowsAt } from "./desktop.js";
import { asDipPoint, asDipRect, asPhysicalPoint } from "./geometry.js";
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

/**
 * The image that goes with the question, from a capture of the display with the strokes on it: the marked area,
 * padded for context, at most 1600 px on its longest side. The same framing as the still's (ui/marker.js compose).
 * @param {Electron.NativeImage} shot @param {{ points: { x: number, y: number }[] }[]} strokes points in DIP, on the display
 * @param {Electron.Display} display @returns {string} base64 PNG
 */
export function cropMarked(shot, strokes, display) {
  const PEN = 18, MAX_IMAGE = 1600;
  const { width: W, height: H } = shot.getSize();
  const sf = W / display.bounds.width;
  const pts = strokes.flatMap((s) => s.points);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const u = { x: (Math.min(...xs) - PEN) * sf, y: (Math.min(...ys) - PEN) * sf, r: (Math.max(...xs) + PEN) * sf, b: (Math.max(...ys) + PEN) * sf };
  const w = Math.round(Math.min(W, Math.max(u.r - u.x + 240 * sf, 900)));
  const h = Math.round(Math.min(H, Math.max(u.b - u.y + 200 * sf, 600)));
  const x = Math.round(Math.min(Math.max((u.x + u.r) / 2 - w / 2, 0), W - w));
  const y = Math.round(Math.min(Math.max((u.y + u.b) / 2 - h / 2, 0), H - h));
  const k = Math.min(1, MAX_IMAGE / Math.max(w, h));
  const crop = shot.crop({ x, y, width: w, height: h });
  return (k < 1 ? crop.resize({ width: Math.round(w * k), height: Math.round(h * k), quality: "good" }) : crop).toPNG().toString("base64");
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
 *   live?: (display: Electron.Display, onEvent: (e: import("./marker-live.js").LiveEvent) => void) => Promise<import("./marker-live.js").LiveOverlay>, // marker-live.js
 *   toDipPoint?: (p: PhysicalPoint) => DipPoint,
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
  /** @type {import("./marker-live.js").LiveOverlay | null} live marking's overlay, while it's up (marker-live.js) */
  let live = null;
  /** @type {Electron.BrowserWindow | null} live marking's toolbar (marker-bar.html) */
  let bar = null;

  async function start({ capture = deps.grabDisplay, display = screen.getDisplayNearestPoint(deps.cursor()), timeoutMs = 10000 } = {}) {
    if (mode() !== "idle") return;
    if (!deps.ready()) return deps.summon();
    clear();
    enter("marking");
    deps.marked();
    deps.hideBubble();
    progress("Getting the screen ready…");
    markDisplay = display;
    // Live first: the user draws over their running apps. Only if that can't start, on a still of the screen.
    if (deps.live && capture === deps.grabDisplay && (await startLive(display))) return;
    if (mode() !== "marking" || markDisplay !== display) return;
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

  // ---------- Live marking (marker-live.js): drawing over the running apps ----------

  /** Starts the overlay and its toolbar. Resolves whether it's up (false: use the still instead). @param {Electron.Display} display */
  async function startLive(display) {
    const job = { abort: new AbortController(), started: Date.now(), display, ready: false, readyTimer: null };
    markStartup = job;
    globalShortcut.register("Escape", cancel);
    let handle;
    try {
      handle = await /** @type {NonNullable<typeof deps.live>} */ (deps.live)(display, (e) => onLive(e, handle));
    } catch (err) {
      trace({ kind: "mark-live-failed", why: String(err?.message ?? err).slice(0, 300) });
      if (markStartup === job) markStartup = null;
      return false;
    }
    // Cancelled while it was starting: it goes, and nothing else happens.
    if (markStartup !== job || mode() !== "marking") {
      handle.quit();
      return true;
    }
    live = handle;
    job.ready = true;
    trace({ kind: "mark-ready", live: true, ms: Date.now() - job.started });
    showBar(display);
    deps.keepIsland();
    progress("Click to explain · draw to ask");
    // The overlay never takes the keyboard (so the toolbar stays above it): its keys come as shortcuts while marking.
    globalShortcut.register("Return", () => finishLive());
    globalShortcut.register("CommandOrControl+Z", () => live?.send({ cmd: "undo" }));
    return true;
  }

  /** @param {import("./marker-live.js").LiveEvent} e @param {import("./marker-live.js").LiveOverlay | undefined} from */
  function onLive(e, from) {
    if (!from || from !== live || mode() !== "marking") return;
    if (e.ev === "count") {
      progress(e.n ? `${e.n} marked · Enter to ask` : "Click to explain · draw to ask");
      if (bar && !bar.isDestroyed()) bar.webContents.send("mark-bar-count", e.n);
    } else if (e.ev === "click" && deps.toDipPoint) {
      const dip = deps.toDipPoint(asPhysicalPoint({ x: e.x, y: e.y }));
      stop();
      enter("working");
      progress("Looking at that…");
      setTimeout(() => deps.explain(dip), 120);
    } else if (e.ev === "key") {
      if (e.key === "enter") finishLive();
      else cancel();
    } else if (e.ev === "exit") {
      live = null;
      cancel();
    }
  }

  /** The toolbar, at the top of the display, above the overlay; it never takes the keyboard unless clicked. @param {Electron.Display} display */
  function showBar(display) {
    const width = 720, height = 52;
    bar = new BrowserWindow({
      x: Math.round(display.bounds.x + display.bounds.width / 2 - width / 2), y: display.bounds.y + 44, width, height,
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: false, show: false, focusable: true,
      webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false },
    });
    bar.setAlwaysOnTop(true, "screen-saver");
    bar.once("ready-to-show", () => bar?.showInactive());
    bar.loadFile(path.join(here, "ui/marker-bar.html"));
  }

  function closeBar() {
    const b = bar;
    bar = null;
    if (b && !b.isDestroyed()) b.destroy();
  }

  // Ask: the overlay stops taking the mouse and keeps the strokes on screen; the display is captured with them on it,
  // and the marked part goes with the question, as from the still.
  async function finishLive() {
    if (mode() !== "marking" || !live || !markDisplay) return;
    const handle = live;
    const display = markDisplay;
    closeBar();
    handle.send({ cmd: "finish" });
    let done;
    try {
      done = await handle.next("finished", 3000);
    } catch {
      return cancel();
    }
    if (handle !== live || mode() !== "marking") return;
    const toDip = /** @type {NonNullable<typeof deps.toDipPoint>} */ (deps.toDipPoint);
    const strokes = (done.strokes ?? []).map((/** @type {any} */ s) => ({
      n: s.n,
      points: (s.points ?? []).map((/** @type {[number, number]} */ [x, y]) => {
        const d = toDip(asPhysicalPoint({ x, y }));
        return { x: d.x - display.bounds.x, y: d.y - display.bounds.y };
      }),
    }));
    if (!strokes.length) return cancel();
    progress("Reading what you marked…");
    let image;
    try {
      image = cropMarked(await deps.grabDisplay(display, new AbortController().signal), strokes, display);
    } catch (err) {
      if (handle !== live) return;
      stop();
      enter("idle");
      clear();
      return notice(`Couldn't capture what you marked: ${err.message}`);
    }
    if (handle !== live || mode() !== "marking") return;
    await finish({ image, strokes });
  }

  // Takes the still (or the live overlay and its toolbar) down; the caller decides what mode comes next.
  // `delay` keeps it up a moment so the overlay can paint the finished marks underneath first.
  function stop(delay = 0) {
    const startup = markStartup;
    markStartup = null;
    clearTimeout(startup?.readyTimer);
    startup?.abort.abort();
    globalShortcut.unregister("Return");
    globalShortcut.unregister("Escape");
    globalShortcut.unregister("CommandOrControl+Z");
    const win = markWin;
    markWin = null;
    if (win && !win.isDestroyed()) setTimeout(() => win.isDestroyed() || win.destroy(), delay);
    closeBar();
    const overlay = live;
    live = null;
    if (overlay) setTimeout(() => overlay.quit(), delay);
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
  // Live marking's toolbar (marker-bar.html), taken only from that window.
  ipcMain.on("mark-bar", (e, command) => {
    if (!bar || bar.isDestroyed() || e.sender !== bar.webContents || mode() !== "marking") return;
    if (command === "undo") live?.send({ cmd: "undo" });
    else if (command === "ask") finishLive();
    else if (command === "cancel") cancel();
  });
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
    /** Live marking's overlay and toolbar, while they're up (for the dev checks). */
    liveOverlay: () => live,
    liveBar: () => bar,
  };
}
