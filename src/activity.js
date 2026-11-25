// What Buddy changed on the user's PC, in plain words, and undoing it. Every file Buddy makes, replaces or edits, every
// document, every PowerShell run, every web page read and every click, keypress and bit of typing Buddy did in an app
// is listed (Settings › Activity) for a week. Files can be put back with one click: a file Buddy made goes to the
// Recycle Bin, a replaced or edited one gets its old version back. What Buddy did in an app is undone in that app.
// Undo checks the file is still as Buddy left it; if the user has changed it since, undo asks before losing that.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const KEEP_MS = 7 * 24 * 3600_000;
const MAX_ENTRIES = 500;

/** A file's content fingerprint, or null when it isn't there. */
export function fingerprint(/** @type {string} */ file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/** Hash large copies in chunks, leaving the main process responsive. */
export async function copyFingerprint(/** @type {string} */ file, /** @type {AbortSignal} */ signal = undefined) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

/** Removes undo copies older than a week. */
export function pruneUndo(/** @type {string} */ undoDir, now = Date.now()) {
  try {
    for (const d of fs.readdirSync(undoDir)) {
      const at = Number(d.split("-")[0]);
      if (at && now - at > KEEP_MS) fs.rmSync(path.join(undoDir, d), { recursive: true, force: true });
    }
  } catch {}
}

/** Copies a file about to change into the undo folder, and clears copies older than a week. Returns the copy. */
export function keepCopy(/** @type {string} */ file, /** @type {string} */ undoDir) {
  pruneUndo(undoDir);
  const dir = path.join(undoDir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`);
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, "contents");
  fs.copyFileSync(file, copy);
  fs.writeFileSync(path.join(dir, "from.txt"), file);
  return copy;
}

/**
 * One change. `file` is what changed; `copy` its earlier version (replaced, edited); `after` the fingerprint Buddy
 * left it with, so undo can tell whether the user changed it since. `from` is who did it: "Buddy", a task, a routine.
 * `made`: the files a copy made (copy_files), each with its fingerprint; `file` is then the folder they went into.
 * @typedef {{ id: string, at: string, from: string, kind: "created" | "replaced" | "edited" | "document" | "ran" | "read" | "acted", summary: string, file?: string, copy?: string, after?: string | null, made?: { file: string, after: string | null }[], batchId?: string, copying?: boolean, undone?: string }} Change
 */

/** What can be undone, by kind. */
export const UNDOABLE = new Set(["created", "replaced", "edited", "document"]);

/**
 * @param {{ file: string, undoDir: string, trash: (file: string) => Promise<void>, onChange?: () => void }} o
 */
export function createActivity({ file, undoDir, trash, onChange }) {
  /** @type {Change[]} */
  let entries = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(saved)) entries = saved.filter((e) => e && typeof e.id === "string" && typeof e.summary === "string");
    for (const entry of entries) {
      delete entry.copying; // An interrupted batch can be undone immediately after restart.
      // Older versions overwrote this particular backup with the source path.
      if (typeof entry.copy === "string" && path.basename(entry.copy).toLowerCase() === "from.txt") delete entry.copy;
    }
  } catch {}

  const save = (refresh = true) => {
    const now = Date.now();
    entries = entries.filter((e) => now - Date.parse(e.at) < KEEP_MS).slice(-MAX_ENTRIES);
    let saved = false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entries, null, 1));
      fs.renameSync(tmp, file);
      saved = true;
    } catch {}
    if (refresh) onChange?.();
    return saved;
  };

  return {
    /** Records a change. @param {Omit<Change, "id" | "at">} change @returns {Change} */
    add(change) {
      const batch = change.batchId && entries.find(e => e.batchId === change.batchId);
      const entry = batch || { ...change, id: crypto.randomBytes(6).toString("hex"), at: new Date().toISOString() };
      if (batch) Object.assign(entry, change);
      else entries.push(entry);
      if (!save(!batch || !entry.copying) && entry.batchId) throw new Error("Couldn't save the undo history for these copies.");
      return entry;
    },

    /** Newest first, each with whether it can be undone now. */
    list() {
      return entries
        .slice()
        .reverse()
        .map((e) => ({ ...e, canUndo: !e.copying && !e.undone && UNDOABLE.has(e.kind) && (e.kind === "created" || e.kind === "document" || (!!e.copy && fs.existsSync(e.copy))) }));
    },

    /**
     * Puts a change back. Without `force`, a file changed since Buddy changed it is left alone and `changed` says so.
     * @param {string} id @param {{ force?: boolean }} [opts]
     * @returns {Promise<{ ok: boolean, message: string, changed?: boolean }>}
     */
    async undo(id, { force = false } = {}) {
      const e = entries.find((x) => x.id === id);
      if (!e) return { ok: false, message: "That change is no longer kept." };
      if (e.copying) return { ok: false, message: "Wait for Buddy to finish copying these files." };
      if (e.undone) return { ok: false, message: "That's already undone." };
      if (!UNDOABLE.has(e.kind) || !e.file) return { ok: false, message: "Buddy can't undo this one by itself." };
      const name = path.basename(e.file);
      // Copies into a folder: exactly the files made, each only if it's still as it was made, unless `force`. The
      // folder itself stays: it may hold the user's own files.
      if (e.made) {
        const left = e.made.filter((m) => fs.existsSync(m.file));
        const changed = [];
        for (const m of left) {
          try {
            if (!m.after || await copyFingerprint(m.file) !== m.after) changed.push(m);
          } catch {
            return { ok: false, message: `Couldn't check ${path.basename(m.file)}. Try again when the file is available.` };
          }
        }
        if (changed.length && !force) return { ok: false, changed: true, message: changed.length === 1 ? `${path.basename(changed[0].file)} has changed since Buddy copied it. Undoing would lose those changes.` : `${changed.length} of the copies have changed since Buddy made them. Undoing would lose those changes.` };
        try {
          for (const m of left) await trash(m.file);
        } catch (err) {
          return { ok: false, message: `Couldn't move the copies to the Recycle Bin: ${err?.message ?? err}` };
        }
        e.undone = new Date().toISOString();
        save();
        return { ok: true, message: left.length === 1 ? `${path.basename(left[0].file)} is in the Recycle Bin.` : `The ${left.length} copies are in the Recycle Bin.` };
      }
      const now = fingerprint(e.file);
      if (now && e.after && now !== e.after && !force) return { ok: false, changed: true, message: `${name} has changed since Buddy did this. Undoing would lose those changes.` };
      if (e.kind === "created" || e.kind === "document") {
        if (now) {
          try {
            await trash(e.file);
          } catch (err) {
            return { ok: false, message: `Couldn't move ${name} to the Recycle Bin: ${err?.message ?? err}` };
          }
        }
        e.undone = new Date().toISOString();
        save();
        return { ok: true, message: `${name} is in the Recycle Bin.` };
      }
      if (!e.copy || !fs.existsSync(e.copy)) return { ok: false, message: `The old version of ${name} is no longer kept.` };
      // The version being replaced is kept too, in case the undo itself was a mistake.
      if (now) keepCopy(e.file, undoDir);
      fs.mkdirSync(path.dirname(e.file), { recursive: true });
      fs.copyFileSync(e.copy, e.file);
      e.undone = new Date().toISOString();
      save();
      return { ok: true, message: `${name} is back as it was.` };
    },
  };
}
