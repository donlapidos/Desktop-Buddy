// Live marking: the native overlay (marker-overlay.cs) the user draws on while their apps keep running underneath.
// It's compiled once on this PC by the C# compiler that comes with Windows (.NET Framework 4), into Buddy's data folder,
// named after its source's fingerprint so a new version builds again. If it can't be built or started, Mark falls back
// to drawing on a still of the screen (marker.js).
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// A file the C# compiler reads from disk, so an installed Buddy keeps it outside its app archive (as wall.ps1).
export const OVERLAY_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)).replace(/app\.asar([\\/])/, "app.asar.unpacked$1"), "marker-overlay.cs");

/** Windows' own C# compiler, or null. @param {NodeJS.ProcessEnv} [env] */
export function findCompiler(env = process.env) {
  const root = env.SystemRoot ?? env.windir ?? "C:\\Windows";
  for (const framework of ["Framework64", "Framework"]) {
    const csc = path.join(root, "Microsoft.NET", framework, "v4.0.30319", "csc.exe");
    if (fs.existsSync(csc)) return csc;
  }
  return null;
}

/**
 * The overlay program, built if this version isn't yet. Resolves its path, or throws saying why it couldn't be built.
 * @param {{ source?: string, cacheDir: string, compiler?: string | null }} o
 */
export async function overlayProgram({ source = OVERLAY_SOURCE, cacheDir, compiler = findCompiler() }) {
  const code = fs.readFileSync(source);
  const exe = path.join(cacheDir, `marker-overlay-${crypto.createHash("sha256").update(code).digest("hex").slice(0, 12)}.exe`);
  if (fs.existsSync(exe)) return exe;
  if (!compiler) throw new Error("Windows' C# compiler (.NET Framework 4) isn't on this PC.");
  fs.mkdirSync(cacheDir, { recursive: true });
  const tmp = `${exe}.${process.pid}.tmp`;
  await new Promise((resolve, reject) => {
    execFile(compiler, ["-nologo", "-target:winexe", "-optimize+", "-r:System.Drawing.dll", "-r:System.Web.Extensions.dll", `-out:${tmp}`, source],
      { windowsHide: true, timeout: 60_000 }, (err, stdout) => (err ? reject(new Error(`The overlay didn't build: ${String(stdout || err.message).trim().slice(0, 300)}`)) : resolve(null)));
  });
  fs.renameSync(tmp, exe);
  // Older versions go: only this one is used from now on.
  for (const old of fs.readdirSync(cacheDir)) if (/^marker-overlay-[0-9a-f]{12}\.exe$/.test(old) && path.join(cacheDir, old) !== exe) fs.rmSync(path.join(cacheDir, old), { force: true });
  return exe;
}

/**
 * @typedef {{ ev: "ready" } | { ev: "count", n: number } | { ev: "click", x: number, y: number } | { ev: "key", key: "enter" | "escape" }
 *   | { ev: "finished", strokes: { n: number, points: [number, number][] }[] } | { ev: "probe", alpha: number } | { ev: "stats", updates: number, avgMs: number, maxMs: number }
 *   | { ev: "error", message: string } | { ev: "exit" }} LiveEvent
 * @typedef {{ send: (cmd: object) => void, next: (ev: string, ms?: number) => Promise<any>, quit: () => void, pid: number | undefined }} LiveOverlay
 */

/**
 * Starts the overlay over `bounds` (physical pixels) and resolves once it's on screen, or rejects. Its events go to
 * `onEvent` (points in physical pixels on the screen).
 * @param {string} exe
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 * @param {{ scale: number, color: string, pen?: number, onEvent: (e: LiveEvent) => void, timeoutMs?: number }} o
 * @returns {Promise<LiveOverlay>}
 */
export function startOverlay(exe, bounds, { scale, color, pen = 18, onEvent, timeoutMs = 8000 }) {
  const child = spawn(exe, [], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  /** @type {{ ev: string, resolve: (e: any) => void }[]} */
  const waiting = [];
  let gone = false;
  const send = (/** @type {object} */ cmd) => {
    if (!gone && child.stdin.writable) child.stdin.write(`${JSON.stringify(cmd)}\n`);
  };
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const i = waiting.findIndex((w) => w.ev === ev.ev);
    if (i >= 0) waiting.splice(i, 1)[0].resolve(ev);
    onEvent(ev);
  });
  child.stdin.on("error", () => {});
  const handle = {
    send,
    next: (/** @type {string} */ ev, ms = 5000) => new Promise((resolve, reject) => {
      const w = { ev, resolve };
      waiting.push(w);
      setTimeout(() => {
        const i = waiting.indexOf(w);
        if (i >= 0) (waiting.splice(i, 1), reject(new Error(`The overlay didn't answer (${ev}).`)));
      }, ms);
    }),
    quit: () => {
      send({ cmd: "quit" });
      setTimeout(() => gone || child.kill(), 1500);
    },
    pid: child.pid,
  };
  return new Promise((resolve, reject) => {
    child.on("error", (err) => reject(err));
    child.on("exit", () => {
      gone = true;
      onEvent({ ev: "exit" });
      reject(new Error("The overlay closed before it was ready."));
    });
    send({ cmd: "start", x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height, scale, pen, color });
    handle.next("ready", timeoutMs).then(() => resolve(handle), (err) => (child.kill(), reject(err)));
  });
}
