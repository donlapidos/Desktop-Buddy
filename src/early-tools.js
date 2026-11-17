// Starting to point before the model has finished writing its call. A guide's route can run to hundreds of tokens;
// its first step is complete long before the rest, and the pointer can be on it while the model writes the others.
// Only pointing and guiding start early. Anything that acts waits for its whole call and its approval card: an act
// cut short must do nothing, so it's never looked at here.

/** The tools that may start before their call is complete. */
export const EARLY_TOOLS = new Set(["guide_steps", "point_at"]);

/** Index just past the JSON string starting at `i` (a quote), or -1 if it isn't closed yet. */
function stringEnd(/** @type {string} */ raw, /** @type {number} */ i) {
  for (let j = i + 1; j < raw.length; j++) {
    if (raw[j] === "\\") j++;
    else if (raw[j] === '"') return j + 1;
  }
  return -1;
}

/** Index just past the JSON object or array starting at `i`, or -1 if it isn't closed yet. */
function blockEnd(/** @type {string} */ raw, /** @type {number} */ i) {
  let depth = 0;
  for (let j = i; j < raw.length; j++) {
    const c = raw[j];
    if (c === '"') {
      j = stringEnd(raw, j) - 1;
      if (j < 0) return -1;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return j + 1;
    }
  }
  return -1;
}

/**
 * Where the value of the top-level `key` starts in a partial JSON object, or -1. Keys inside nested values are skipped.
 * @param {string} raw @param {string} key
 */
function valueStart(raw, key) {
  let depth = 0;
  for (let j = 0; j < raw.length; j++) {
    const c = raw[j];
    if (c === '"') {
      const end = stringEnd(raw, j);
      if (end < 0) return -1;
      if (depth === 1 && raw.slice(j, end) === JSON.stringify(key)) {
        const colon = raw.slice(end).match(/^\s*:\s*/);
        if (colon) return end + colon[0].length;
      }
      j = end - 1;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return -1;
}

/** The top-level `key`'s value once it's complete (a string, or an object or array), else undefined. */
function completeValue(/** @type {string} */ raw, /** @type {string} */ key) {
  const at = valueStart(raw, key);
  if (at < 0 || at >= raw.length) return undefined;
  const end = raw[at] === '"' ? stringEnd(raw, at) : raw[at] === "{" || raw[at] === "[" ? blockEnd(raw, at) : -1;
  if (end < 0) return undefined;
  try { return JSON.parse(raw.slice(at, end)); } catch { return undefined; }
}

/** The first element of the top-level array `key`, once that element is complete. */
function firstItem(/** @type {string} */ raw, /** @type {string} */ key) {
  const at = valueStart(raw, key);
  if (at < 0 || raw[at] !== "[") return undefined;
  const open = raw.slice(at + 1).search(/\S/);
  if (open < 0 || raw[at + 1 + open] !== "{") return undefined;
  const start = at + 1 + open;
  const end = blockEnd(raw, start);
  if (end < 0) return undefined;
  try { return JSON.parse(raw.slice(start, end)); } catch { return undefined; }
}

/**
 * What can be started from a call still being written (`raw` is its arguments so far), or null.
 * point_at: its ref (or mark) and caption, once both are complete. guide_steps: its first step, once complete.
 * @param {string} name @param {string} raw
 * @returns {{ ref?: string, mark?: number, caption: string } | { step: any } | null}
 */
export function earlyInput(name, raw) {
  if (!EARLY_TOOLS.has(name) || typeof raw !== "string") return null;
  if (name === "point_at") {
    const caption = completeValue(raw, "caption");
    const ref = completeValue(raw, "ref");
    if (typeof caption !== "string") return null;
    if (typeof ref === "string" && ref) return { ref, caption };
    // A mark is a number: complete once something follows it.
    const mark = raw.match(/"mark"\s*:\s*(\d+)\s*[,}]/);
    return mark ? { mark: Number(mark[1]), caption } : null;
  }
  const step = firstItem(raw, "steps");
  return step && typeof step.target === "string" && step.target.trim() ? { step } : null;
}
