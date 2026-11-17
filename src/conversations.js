// Conversations that survive a restart: the bubble's and each task window's, kept on this PC in conversations.json
// (Settings › AI & privacy forgets them). Only what was said is kept, in plain words: the user's questions and Buddy's
// replies. Screenshots, window contents and the model's own history are never written, and anything shaped like a
// secret key is hidden first. A resumed conversation hands that transcript to its Brain (brain.js resume) as context.
import fs from "node:fs";
import { hideSecrets } from "./pc-tools.js";

export const KEEP_DAYS = 7; // a task untouched this long is forgotten
export const MAX_TASKS = 6; // as many as can be open (tasks.js)
const MAX_ENTRIES = 40; // the latest lines of a conversation
const MAX_TEXT = 4000; // characters of one line
const TITLE = 80;

/**
 * One line of a conversation, as Brain.transcript() gives it.
 * @typedef {{ role: "user" | "buddy", text: string }} Line
 * A kept conversation. `id` is "bubble" or a task's id ("t3"); `n` is the task's number.
 * @typedef {{ id: string, n: number, title: string, target: { app_name: string, title: string } | null, savedAt: number, transcript: Line[] }} Kept
 */

/** @param {any} lines @returns {Line[]} */
function cleanTranscript(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l) => (l?.role === "user" || l?.role === "buddy") && typeof l.text === "string" && l.text.trim())
    .slice(-MAX_ENTRIES)
    .map((l) => ({ role: l.role, text: hideSecrets(l.text.slice(0, MAX_TEXT)).text }));
}

/** A kept conversation from anything, or null when it can't be one. @param {any} c @returns {Kept | null} */
function clean(c) {
  if (!c || typeof c !== "object" || typeof c.id !== "string" || !/^(bubble|t\d{1,6})$/.test(c.id)) return null;
  const transcript = cleanTranscript(c.transcript);
  if (!transcript.length || !Number.isFinite(c.savedAt)) return null;
  const t = c.target && typeof c.target === "object" ? c.target : null;
  return {
    id: c.id,
    n: Number.isInteger(c.n) && c.n > 0 ? c.n : 0,
    title: typeof c.title === "string" ? c.title.slice(0, TITLE) : "",
    target: t ? { app_name: String(t.app_name ?? "").slice(0, 120), title: String(t.title ?? "").slice(0, 200) } : null,
    savedAt: c.savedAt,
    transcript,
  };
}

/** @param {{ file: string, now?: () => number }} opts */
export function createConversations({ file, now = Date.now }) {
  /** @type {Map<string, Kept>} */
  let kept = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const c of Array.isArray(raw) ? raw : []) {
      const ok = clean(c);
      if (ok && now() - ok.savedAt < KEEP_DAYS * 86_400_000) kept.set(ok.id, ok);
    }
  } catch {}

  function write() {
    try {
      if (!kept.size) return fs.rmSync(file, { force: true });
      // Through a temporary file, so a crash mid-write can't leave half a file.
      fs.writeFileSync(`${file}.tmp`, JSON.stringify([...kept.values()]));
      fs.renameSync(`${file}.tmp`, file);
    } catch {}
  }

  /** @param {string} id */
  function forget(id) {
    if (kept.delete(id)) write();
  }

  return {
    /** Keeps (or replaces) a conversation; one with nothing said yet is forgotten instead. @param {Omit<Kept, "savedAt">} c */
    save(c) {
      const ok = clean({ ...c, savedAt: now() });
      if (!ok) return forget(c.id);
      kept.set(ok.id, ok);
      // The oldest tasks go first when there are more than can be open.
      const tasks = [...kept.values()].filter((x) => x.id !== "bubble").sort((a, b) => b.savedAt - a.savedAt);
      for (const old of tasks.slice(MAX_TASKS)) kept.delete(old.id);
      write();
    },
    forget,
    /** The kept tasks, oldest first. @returns {Kept[]} */
    tasks: () => [...kept.values()].filter((x) => x.id !== "bubble").sort((a, b) => a.savedAt - b.savedAt),
    /** The bubble's conversation and when it was saved, if that was within `withinMs`. @param {number} withinMs */
    bubble: (withinMs) => {
      const b = kept.get("bubble");
      return b && now() - b.savedAt < withinMs ? { transcript: b.transcript, savedAt: b.savedAt } : null;
    },
    count: () => kept.size,
    clear() {
      kept = new Map();
      write();
    },
  };
}
