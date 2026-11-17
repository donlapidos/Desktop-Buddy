// The window an explainer plate opens in (explainer.js renders it): beside where the user was looking, in a session of
// its own. Model-written plates run with a strict CSP, sanitized SVG, and a session that refuses every network request.
import { BrowserWindow, nativeTheme, screen, session, systemPreferences } from "electron";
import fs from "node:fs";
import path from "node:path";
import { renderExplainer } from "./explainer.js";

/** @typedef {import("./geometry.js").DipPoint} DipPoint */

const EXPLAINER = { width: 640, height: 760 };
const EXPLAINER_PARTITION = "explainer";

/** Locks the plates' session down, and lets only Buddy's voice page open the microphone. Once, at startup. */
export function lockExplainerSession() {
  const plates = session.fromPartition(EXPLAINER_PARTITION);
  plates.webRequest.onBeforeRequest((details, done) => {
    done({ cancel: !/^(file|data):/.test(details.url) });
  });
  plates.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  // Only Buddy's voice page may open the microphone.
  session.defaultSession.setPermissionRequestHandler((wc, permission, done) => {
    done(permission !== "media" || wc.getURL().endsWith("/ui/voice.html"));
  });
}

const appLabel = (win) => win?.app_name?.replace(/\.exe$/i, "") || null;

/**
 * Writes the plate into `dir` (numbered after the ones already there) and opens it. `near` is where the plate opens
 * beside; `observed` is the window the subject was seen in. Callers pass their own, so a task's plate doesn't borrow
 * the bubble's place or app.
 * @param {any} explainer
 * @param {{ near: DipPoint, observed?: { app_name?: string } | null, dir: string, icon: string }} where
 */
export function openExplainer(explainer, { near, observed = null, dir, icon }) {
  fs.mkdirSync(dir, { recursive: true });
  const plateNo = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).length + 1;
  const date = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  const reducedMotion = process.platform === "win32" && systemPreferences.getAnimationSettings().prefersReducedMotion;
  const page = renderExplainer(explainer, { plateNo, observedIn: appLabel(observed), date, reducedMotion });
  const file = path.join(dir, `${Date.now()}.html`);
  fs.writeFileSync(file, page);
  const title = explainer.common_name ?? "Explainer";

  const anchor = near;
  const { workArea } = screen.getDisplayNearestPoint(anchor);
  const w = Math.min(EXPLAINER.width, workArea.width - 32);
  const h = Math.min(EXPLAINER.height, workArea.height - 32);
  const right = anchor.x + 40 + w <= workArea.x + workArea.width;
  const dark = nativeTheme.shouldUseDarkColors;
  const win = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(right ? anchor.x + 40 : Math.max(workArea.x + 16, anchor.x - 40 - w)),
    y: Math.round(Math.min(Math.max(anchor.y - h / 3, workArea.y + 16), workArea.y + workArea.height - h - 16)),
    title,
    show: false,
    titleBarStyle: "hidden",
    titleBarOverlay: { color: dark ? "#131815" : "#f2f4f0", symbolColor: dark ? "#aab5ad" : "#4c5650", height: 40 },
    backgroundColor: dark ? "#131815" : "#f2f4f0",
    icon,
    // JavaScript is on only for the motion player: each plate's CSP admits that one script by hash, the model's
    // SVG is sanitized, and the partition still refuses every network request.
    webPreferences: { javascript: true, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: EXPLAINER_PARTITION, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(file);
  win.once("ready-to-show", () => win.showInactive());
}
