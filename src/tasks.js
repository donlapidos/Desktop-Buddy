// Task agents: each task is its own Claude conversation in its own window. Minimizing a task tucks it into a chip
// on the island; closing it stops the agent and forgets it. Tasks work side by side; anything that clicks or types
// takes turns (see takeTurn in brain.js), and each task asks for approval in its own window.
// A task's conversation is kept on the PC (conversations.js) after each answer, and comes back after a restart as a
// chip on the island; its window is made only when it's first shown.
import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { t as tr } from "./i18n.js";
import { canMoveTask, taskBusy } from "./modes.js";
import { questionTiming } from "./latency.js";

const TASK = { width: 420, height: 560 };
const MAX_TASKS = 6;
const ARM_MS = 500;

const shorten = (text, n = 34) => {
  const t = String(text).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * @param {{
 *   here: string, icon: string,
 *   makeBrain: (ui: object) => any,      // a new Brain wired to this ui, or null without an API key
 *   currentTarget: () => Promise<any>,   // the user's foreground window, Buddy's own windows excluded
 *   point: (bounds: import("./geometry.js").PhysicalRect, caption: string, owner: string) => Promise<void>, // the shared pointer; each task points as its own owner
 *   release: (owner: string, ms?: number) => void,     // lets go of the pointer if that owner still has it
 *   annotate?: (items: any[], context: any, owner: string) => Promise<boolean>,
 *   clearAnnotations?: (owner: string, ms?: number) => void,
 *   explain: (plate: object, observed: any) => void,  // opens a plate seen in `observed` (the task's window)
 *   onChange: (tasks: object[]) => void,               // the island's chips
 *   keep?: { save: (c: any) => void, forget: (id: string) => void, tasks: () => any[] }, // conversations.js
 *   trace?: (entry: object) => void,                   // timing.log: a refused state change is a bug
 * }} deps
 */
export function createTasks({ here, icon, makeBrain, currentTarget, point, release, annotate, clearAnnotations, explain, onChange, keep, trace }) {
  const tasks = new Map();
  let seq = 0;
  // Buddy quitting closes every task window; that keeps their conversations instead of forgetting them.
  let quitting = false;
  app.on("before-quit", () => (quitting = true));

  const alive = (t) => !!t.win && !t.win.isDestroyed();
  const summary = () =>
    [...tasks.values()].map((t) => ({ id: t.id, n: t.n, title: t.title, state: t.state, line: t.line, open: alive(t) && t.win.isVisible() }));
  const changed = () => onChange(summary());
  const fromSender = (sender) => [...tasks.values()].find((t) => alive(t) && t.win.webContents === sender);
  const send = (t, channel, payload) => {
    if (alive(t)) t.win.webContents.send(channel, payload);
  };
  const save = (t) => keep?.save({ id: t.id, n: t.n, title: t.title, target: t.where ? { app_name: t.where.app, title: t.where.title } : null, transcript: t.brain.transcript() });

  // Every change of a task's state goes through here; a move modes.js TASK_NEXT doesn't allow is refused and logged.
  /** @param {any} t @param {import("./modes.js").TaskState} state @param {string} [line] */
  function setState(t, state, line) {
    if (!canMoveTask(t.state, state)) {
      trace?.({ kind: "refused-task-state", task: t.id, from: t.state, to: state });
      return false;
    }
    t.state = state;
    t.line = line ?? (state === "idle" || state === "done" ? t.brain?.transcript().filter((m) => m.role === "buddy").at(-1)?.text ?? "" : t.line);
    send(t, "task-state", { state, line, title: t.title });
    changed();
    return true;
  }

  // New windows cascade down from the top right, clear of the island.
  function place(n) {
    const { workArea } = screen.getPrimaryDisplay();
    const k = (n - 1) % 5;
    return { x: workArea.x + workArea.width - TASK.width - 24 - k * 28, y: workArea.y + 64 + k * 28 };
  }

  function uiFor(t) {
    return {
      point: (bounds, caption) => point(bounds, caption, t.id),
      ...(annotate ? { annotate: (items, context) => annotate(items, context, t.id) } : {}),
      clearAnnotations: (ms = 0) => clearAnnotations?.(t.id, ms),
      explain: (plate) => explain(plate, t.target),
      status: (text) => setState(t, "working", text),
      stream: ({ text }) => {
        if (text && tasks.has(t.id)) {
          t.line = text;
          send(t, "task-stream", text);
        }
      },
      // Who made a change, in Settings › Activity.
      source: t.title,
      // Approvals belong to the task asking: its window comes forward (without stealing focus) and its chip turns amber.
      confirm: (summaryText, bounds, note, _signal, detail) => {
        if (bounds) point(bounds, summaryText, t.id);
        const win = windowFor(t, { show: false });
        if (!win.isVisible()) win.showInactive();
        setState(t, "confirm", tr("Waiting for your OK: {what}", { what: summaryText }));
        t.confirmAt = Date.now();
        // Each card has its own number: an answer only counts for the card it was given on.
        t.cardId = (t.cardId ?? 0) + 1;
        send(t, "task-confirm", { id: t.cardId, summary: summaryText, note, detail });
        return new Promise((resolve) => (t.pendingConfirm = resolve));
      },
    };
  }

  /**
   * The task's window, made the first time it's needed. `show` brings it up and gives it the keyboard once loaded;
   * `prompt` is typed into it as if by the user (a routine's).
   * @returns {Electron.BrowserWindow}
   */
  function windowFor(t, { show = true, prompt = null } = {}) {
    if (alive(t)) return t.win;
    t.win = new BrowserWindow({
      ...TASK,
      ...place(t.n),
      minWidth: 340,
      minHeight: 360,
      frame: false,
      show: false,
      skipTaskbar: true,
      backgroundColor: "#0c0d10",
      title: `Buddy · ${t.title}`,
      icon,
      webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false },
    });
    t.win.loadFile(path.join(here, "ui/task.html"));
    t.win.webContents.once("did-finish-load", () => {
      send(t, "task-init", { n: t.n, title: t.title, target: t.where ? `${t.where.app} — ${t.where.title}` : null, transcript: t.brain.transcript() });
      if (show) {
        t.win.show();
        t.win.focus();
      }
      if (prompt) send(t, "task-prompt", prompt);
    });
    // Seeing a finished task's answer settles its chip.
    t.win.on("focus", () => {
      if (t.state === "done") setState(t, "idle");
    });
    t.win.on("show", changed);
    t.win.on("hide", changed);
    t.win.on("closed", () => {
      t.win = null;
      if (!quitting) stop(t);
    });
    return t.win;
  }

  /**
   * Opens a task window. Pass `brain` to move an existing conversation (the bubble's) into it. A routine passes its
   * `title` and `prompt`, `target: null` (it isn't about the window in front) and `tucked`, so it starts in the island.
   * @param {{ brain?: any, target?: any, title?: string, prompt?: string, tucked?: boolean }} [opts]
   */
  async function create({ brain = null, target, title, prompt, tucked = false } = {}) {
    if (tasks.size >= MAX_TASKS) return { error: tr("You can have {n} tasks open at once. Close one first.", { n: MAX_TASKS }) };
    const n = ++seq;
    const t = { id: `t${n}`, n, title: title ? shorten(title) : tr("Task {n}", { n }), state: "idle", target: target === undefined ? await currentTarget() : target, pendingConfirm: null, win: null };
    t.where = t.target ? { app: t.target.app_name, title: t.target.title } : null;
    const ui = uiFor(t);
    if (brain) {
      brain.ui = { ...brain.ui, ...ui };
      t.brain = brain;
      const first = brain.transcript().find((m) => m.role === "user");
      if (first) t.title = shorten(first.text);
    } else {
      t.brain = makeBrain(ui);
      if (!t.brain) return { error: tr("Choose how Buddy thinks first, in Settings › AI & privacy.") };
    }
    windowFor(t, { show: !tucked, prompt });
    tasks.set(t.id, t);
    if (brain) save(t);
    changed();
    return { id: t.id };
  }

  /**
   * The tasks kept from before a restart come back as chips on the island, each with its conversation; a window is
   * made when one is opened. Without a way to think yet (no key), they stay kept for later. Resolves how many came back.
   */
  function restore() {
    let back = 0;
    for (const kept of keep?.tasks() ?? []) {
      if (tasks.size >= MAX_TASKS || tasks.has(kept.id)) continue;
      const n = kept.n || Number(kept.id.slice(1));
      // The window it was about may be gone or renumbered: the conversation names it, and the model looks again.
      const t = { id: kept.id, n, title: kept.title || tr("Task {n}", { n }), state: "idle", target: null, where: kept.target ? { app: kept.target.app_name, title: kept.target.title } : null, pendingConfirm: null, win: null };
      t.brain = makeBrain(uiFor(t));
      if (!t.brain) continue;
      t.brain.resume(kept.transcript);
      t.line = kept.transcript.filter((m) => m.role === "buddy").at(-1)?.text ?? "";
      seq = Math.max(seq, n);
      tasks.set(t.id, t);
      back++;
    }
    if (back) {
      trace?.({ kind: "tasks-restored", n: back });
      changed();
    }
    return back;
  }

  function stop(t) {
    if (!tasks.has(t.id)) return;
    tasks.delete(t.id);
    t.brain.cancel();
    t.pendingConfirm?.("deny");
    t.pendingConfirm = null;
    release(t.id, 0);
    keep?.forget(t.id);
    if (alive(t)) t.win.destroy();
    changed();
  }

  // Island chip: open a tucked-away task, or tuck away an open one.
  function toggle(id) {
    const t = tasks.get(id);
    if (!t) return;
    if (!alive(t)) return windowFor(t);
    if (t.win.isVisible() && t.win.isFocused()) return t.win.hide();
    t.win.show();
    t.win.focus();
  }

  function open(id) {
    const t = tasks.get(id);
    if (!t) return;
    if (!alive(t)) return windowFor(t);
    t.win.show();
    t.win.focus();
  }

  function reply(t, decision, { cancel = false } = {}) {
    if (!t?.pendingConfirm) return;
    // As on the card: an answer in its first half second was a click already on its way. A cancel always counts.
    if (!cancel && Date.now() - (t.confirmAt ?? 0) < ARM_MS) return trace?.({ kind: "confirm-too-soon", task: t.id });
    t.pendingConfirm(decision);
    t.pendingConfirm = null;
    send(t, "task-confirm-done");
    setState(t, "working", decision === "deny" ? tr("Okay, not doing that.") : tr("Working…"));
  }

  // The island's preview of a task: a live picture of its window, taken even while the window is tucked away
  // (stayHidden keeps a hidden window rendering for the capture without showing it). A restored task not yet opened
  // has no window to picture.
  async function peek(id, width = 480) {
    const t = tasks.get(id);
    if (!t || !alive(t)) return null;
    try {
      const img = await t.win.webContents.capturePage(undefined, { stayHidden: true });
      if (img.isEmpty()) return null;
      return `data:image/jpeg;base64,${img.resize({ width, quality: "good" }).toJPEG(82).toString("base64")}`;
    } catch {
      return null;
    }
  }

  ipcMain.handle("task-ask", async (e, text) => {
    const t = fromSender(e.sender);
    if (!t || taskBusy(t.state) || !String(text).trim()) return { reply: null };
    if (t.title === tr("Task {n}", { n: t.n })) {
      t.title = shorten(text);
      t.win.setTitle(`Buddy · ${t.title}`);
    }
    setState(t, "working", tr("Thinking…"));
    const timing = trace ? questionTiming({ write: trace, provider: t.brain.provider, model: t.brain.model }) : null;
    try {
      const reply = await t.brain.ask(text, t.target, { timing });
      if (tasks.has(t.id)) setState(t, alive(t) && t.win.isFocused() ? "idle" : "done");
      return { reply, title: t.title };
    } catch (err) {
      if (tasks.has(t.id)) setState(t, "error", err.message);
      return { reply: tr("Something broke: {why}", { why: err.message }), title: t.title };
    } finally {
      timing?.finish();
      release(t.id);
      if (tasks.has(t.id)) save(t);
    }
  });
  ipcMain.on("task-cancel", (e) => {
    const t = fromSender(e.sender);
    if (!t) return;
    t.brain.cancel();
    reply(t, "deny", { cancel: true });
  });
  ipcMain.on("task-confirm-reply", (e, decision, id) => {
    const t = fromSender(e.sender);
    if (t && id === t.cardId) reply(t, decision);
    else trace?.({ kind: "confirm-other-card", task: t?.id, answered: id, showing: t?.cardId });
  });
  ipcMain.on("task-minimize", (e) => fromSender(e.sender)?.win.hide());
  ipcMain.on("task-close", (e) => {
    const t = fromSender(e.sender);
    if (t) stop(t);
  });

  return {
    create,
    restore,
    toggle,
    open,
    peek,
    // From the island's preview: approve or refuse without opening the window, or close the task.
    answer: (id, decision) => reply(tasks.get(id), decision),
    close: (id) => tasks.has(id) && stop(tasks.get(id)),
    list: summary,
    count: () => tasks.size,
  };
}
