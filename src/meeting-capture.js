// The hidden meeting page (ui/meeting.html), which hears a meeting for meeting.js: the microphone and the PC's sound
// output. It runs in a session of its own, the only one Buddy lets capture the PC's sound (Electron's "loopback"
// audio, through the screen-share request a page makes). The screen that request also hands over is stopped in the
// page at once; nothing of the screen is kept or seen.
import { BrowserWindow, desktopCapturer, ipcMain, session } from "electron";
import path from "node:path";

const READY_MS = 15_000; // how long the page may take to open the microphone and the PC's sound
const STOP_MS = 5_000;

/**
 * @typedef {{ started?: boolean, stopped?: boolean, you?: boolean, others?: boolean, problems?: string[] }} CaptureState
 * @param {{ here: string, onPiece: (piece: { who: "you" | "others", start: number, end: number, pcm: Float32Array }) => void, trace?: (entry: object) => void }} o
 */
export function createMeetingCapture({ here, onPiece, trace = () => {} }) {
  /** @type {BrowserWindow | null} */
  let win = null;
  /** @type {((s: CaptureState) => void) | null} */
  let waiting = null;
  const ses = session.fromPartition("buddy-meeting");
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    // Only Buddy's own meeting page, and only while it's taking notes.
    if (!win || win.isDestroyed() || !request.frame?.url?.endsWith("/ui/meeting.html")) return callback({});
    const [screen] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
    callback(screen ? { video: screen, audio: "loopback" } : {});
  });

  const fromPage = (/** @type {Electron.IpcMainEvent} */ e) => !!win && !win.isDestroyed() && e.sender === win.webContents;
  ipcMain.on("meeting-piece", (e, p) => {
    if (!fromPage(e) || !(p?.pcm instanceof Float32Array)) return;
    onPiece({ who: p.who === "you" ? "you" : "others", start: Number(p.start) || 0, end: Number(p.end) || 0, pcm: p.pcm });
  });
  ipcMain.on("meeting-state", (e, s) => {
    if (!fromPage(e)) return;
    const done = waiting;
    waiting = null;
    done?.(s ?? {});
  });

  /** Resolves the page's next state, or `fallback` after `ms`. */
  const next = (/** @type {number} */ ms, /** @type {CaptureState} */ fallback) => new Promise((resolve) => {
    const timer = setTimeout(() => ((waiting = null), resolve(fallback)), ms);
    waiting = (s) => (clearTimeout(timer), resolve(s));
  });

  return {
    get on() {
      return !!win && !win.isDestroyed();
    },
    /**
     * Opens the page and starts hearing. Resolves which sources it got (`you`, `others`) and what went wrong.
     * @param {{ testMic?: Uint8Array }} [o] testMic: a recording played as the microphone (end-to-end check)
     * @returns {Promise<CaptureState>}
     */
    async start({ testMic } = {}) {
      if (win && !win.isDestroyed()) return { started: true, you: true, others: true };
      win = new BrowserWindow({ show: false, width: 200, height: 100, skipTaskbar: true, webPreferences: { preload: path.join(here, "preload.cjs"), session: ses, backgroundThrottling: false } });
      win.on("closed", () => (win = null));
      await win.loadFile(path.join(here, "ui/meeting.html"));
      const ready = next(READY_MS, { started: false, problems: ["timeout"] });
      win.webContents.send("meeting", { cmd: "start", testMic });
      const state = await ready;
      trace({ kind: "meeting-capture", you: !!state.you, others: !!state.others, problems: state.problems ?? [] });
      if (!state.you && !state.others) this.close();
      return state;
    },
    /** Stops hearing: what's still being said is handed over first. */
    async stop() {
      if (!win || win.isDestroyed()) return;
      const stopped = next(STOP_MS, { stopped: true });
      win.webContents.send("meeting", { cmd: "stop" });
      await stopped;
      this.close();
    },
    close() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
