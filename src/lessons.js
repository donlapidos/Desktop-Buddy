// "Teach me this app" lessons: a guided route someone went all the way through, kept to play again (Settings › Lessons,
// the tray) or to share as a file. A lesson is only words: each step's caption, the control's label as it appears on
// screen, and the text that shows the step is done. Playing one runs Buddy's own route follower (brain.js guideSteps)
// with no model call, and it only points: a lesson can never click, type or open anything. Every lesson is checked
// on the way in, whether saved here or imported from someone else's file.
import crypto from "node:crypto";
import fs from "node:fs";

export const MAX_LESSONS = 100;
const MAX_STEPS = 30;
const WORDS = 120; // characters of a caption, a label, a done-when text
const TITLE = 80;
const ANNOTATIONS = ["highlight", "circle", "arrow", "label", "drag"];
// What an exported lesson file says it is.
export const LESSON_FILE = { kind: "desktop-buddy-lesson", version: 1 };

/**
 * @typedef {{ caption: string, target: string, role?: string, annotation?: { kind: string, to_target?: string, to_role?: string }, done_when: string[] }} Step
 * @typedef {{ id: string, title: string, app: string, steps: Step[], savedAt: number }} Lesson
 */

const words = (v, n = WORDS) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "");

/** A step as a lesson keeps it, or null. @param {any} s @returns {Step | null} */
function cleanStep(s) {
  const caption = words(s?.caption);
  const target = words(s?.target);
  const done = (Array.isArray(s?.done_when) ? s.done_when : []).map((d) => words(d)).filter(Boolean).slice(0, 8);
  if (!caption || !target || !done.length) return null;
  /** @type {Step} */
  const step = { caption, target, done_when: done };
  const role = words(s.role, 30);
  if (role) step.role = role;
  const a = s.annotation;
  if (a && ANNOTATIONS.includes(a.kind)) {
    step.annotation = { kind: a.kind };
    if (words(a.to_target)) step.annotation.to_target = words(a.to_target);
    if (words(a.to_role, 30)) step.annotation.to_role = words(a.to_role, 30);
  }
  return step;
}

/** A lesson from anything, or null when it can't be one (no title or app, or a step that isn't whole). @returns {Lesson | null} */
export function cleanLesson(/** @type {any} */ raw, { id = null, now = Date.now() } = {}) {
  const title = words(raw?.title, TITLE);
  const app = words(raw?.app, 80);
  const given = Array.isArray(raw?.steps) ? raw.steps : [];
  const steps = given.slice(0, MAX_STEPS).map(cleanStep);
  if (!title || !app || !steps.length || steps.some((s) => !s)) return null;
  const keepId = typeof raw?.id === "string" && /^[a-f0-9]{12}$/.test(raw.id) ? raw.id : null;
  return { id: id ?? keepId ?? crypto.randomBytes(6).toString("hex"), title, app, steps: /** @type {Step[]} */ (steps), savedAt: Number.isFinite(raw?.savedAt) ? raw.savedAt : now };
}

/** The app a lesson is for, in words: "EXCEL.EXE" is "Excel". */
export const appName = (/** @type {string} */ app) => {
  const base = app.replace(/\.exe$/i, "");
  return base === base.toUpperCase() ? base.charAt(0) + base.slice(1).toLowerCase() : base;
};

/** @param {{ file: string, now?: () => number }} opts */
export function createLessons({ file, now = Date.now }) {
  /** @type {Lesson[]} */
  let lessons = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const l of Array.isArray(raw) ? raw : []) {
      const ok = cleanLesson(l, { now: now() });
      if (ok && !lessons.some((x) => x.id === ok.id)) lessons.push(ok);
    }
  } catch {}

  function write() {
    try {
      // Through a temporary file, so a crash mid-write can't leave half a file.
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(lessons));
      fs.renameSync(`${file}.tmp`, file);
    } catch {}
  }

  /** Keeps a lesson; resolves it as kept, or an error in words. @returns {{ lesson: Lesson } | { error: string }} */
  function add(/** @type {any} */ raw) {
    if (lessons.length >= MAX_LESSONS) return { error: `You have ${MAX_LESSONS} lessons. Delete one first.` };
    const lesson = cleanLesson({ ...raw, id: undefined, savedAt: undefined }, { now: now() });
    if (!lesson) return { error: "That isn't a lesson Buddy can play." };
    lessons.push(lesson);
    write();
    return { lesson };
  }

  return {
    add,
    list: () => lessons.slice(),
    get: (/** @type {string} */ id) => lessons.find((l) => l.id === id) ?? null,
    remove(/** @type {string} */ id) {
      const before = lessons.length;
      lessons = lessons.filter((l) => l.id !== id);
      if (lessons.length !== before) write();
    },
    /** A lesson as a file to share: what it is, and its words. */
    exportText(/** @type {string} */ id) {
      const l = lessons.find((x) => x.id === id);
      return l ? JSON.stringify({ ...LESSON_FILE, title: l.title, app: l.app, steps: l.steps }, null, 2) : null;
    },
    /** A shared lesson file, checked like any other lesson. */
    importText(/** @type {string} */ text) {
      let raw;
      try {
        raw = JSON.parse(String(text).slice(0, 200_000));
      } catch {
        return { error: "That file isn't a Buddy lesson." };
      }
      if (raw?.kind !== LESSON_FILE.kind) return { error: "That file isn't a Buddy lesson." };
      if (raw.version !== LESSON_FILE.version) return { error: "That lesson is from a newer Buddy. Update Buddy, then import it again." };
      return add(raw);
    },
  };
}
