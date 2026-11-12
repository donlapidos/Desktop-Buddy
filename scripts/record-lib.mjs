// Recording one window for the model check: read it the way Buddy's look does, take out what could identify someone
// (src/scrub.js), and save it to evals/windows/<name>.json with a note of what was replaced. Used by record-window.mjs
// (one window, by id) and record-tour.mjs (sample windows stepped through).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOOK_ARGS, renderTree, snapshotResilient } from "../src/desktop.js";
import { namesToHide, scrubText, scrubTree } from "../src/scrub.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Who to hide: the account name and its parts, the PC's name, and other names given (whole). @param {string[]} [extra] */
export const whoToHide = (extra = []) => ({
  names: namesToHide([os.userInfo().username, process.env.USERNAME ?? ""], extra),
  pc: os.hostname(),
});

/**
 * Records one window. Resolves the saved record, or throws with what went wrong.
 * @param {{ app: string, windowId: string, name: string, note?: string, who: ReturnType<typeof whoToHide> }} o
 */
export async function recordWindow({ app, windowId, name, note = "", who }) {
  const res = await snapshotResilient(["--app", app, "--window-id", windowId], [...LOOK_ARGS], { timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`Couldn't read the window: ${JSON.stringify(res.error)}`);
  const tree = scrubTree(res.data.tree, who);
  const before = JSON.stringify(res.data.tree);
  const after = JSON.stringify(tree);
  const count = (/** @type {string} */ s, /** @type {string} */ k) => (s.match(new RegExp(`<${k}>`, "g")) ?? []).length;
  const replaced = Object.fromEntries(["email", "number", "name", "user", "pc", "path"].map((k) => [k, count(after, k) - count(before, k)]).filter(([, n]) => n > 0));
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, "bin", "agent-desktop.json"), "utf8")).version;
  } catch {}
  const record = {
    name,
    app,
    title: scrubText(res.data.window?.title ?? "", who),
    note,
    recordedAt: new Date().toISOString().slice(0, 10),
    agentDesktop: version,
    refCount: res.data.ref_count ?? null,
    complete: res.data.complete !== false,
    replaced,
    tree,
  };
  const dir = path.join(root, "evals", "windows");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(record, null, 1)}\n`);
  return { record, text: renderTree(tree).text, raw: res.data.tree };
}
