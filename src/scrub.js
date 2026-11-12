// Takes what could identify someone out of a window's accessibility tree before it's saved or shared: email
// addresses, phone and account numbers, web addresses' paths, the user's folder, the PC's name, and the names of the
// people given (the user's own, by default). Each becomes a placeholder that says what it was ("<email>"), so a
// recorded window still reads like the app. Best effort: it finds shapes, not meaning, so a recording is still
// looked over before it's kept.

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// A web address keeps where it goes (scheme and host) and loses what it asked for (path, query, fragment).
const URL_PATH = /\b(https?:\/\/[^\s/?#"'<>]+)[/?#][^\s"'<>]*/gi;
// The user's folder in any path: C:\Users\name\..., also written with forward slashes.
const USER_DIR = /([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])[^\\/\s"'<>]+/gi;
// Phone numbers: seven or more digits, perhaps with +, spaces, dashes, dots or brackets between them.
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{6,}\d(?![\w.])/g;
// Dates look like phone numbers to PHONE, and are left as they are: 2026-11-12, 12/11/2026, 12.11.2026.
const DATE = /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})$/;
// Account, card and ID numbers: nine or more digits in a row.
const LONG_NUMBER = /\b\d{9,}\b/g;

/** The fields of a tree node that carry text someone could have typed or that names them. */
const TEXT_FIELDS = ["name", "value", "description", "help", "title", "placeholder", "role_description"];

/**
 * Names to hide: people's names and their parts ("JaneDoe" also hides "Jane" and "Doe"), and other names (an
 * organisation, a shared folder) whole, since their parts are ordinary words ("PowerBI Hub" must not hide "Power" in
 * Calculator's "Power Converter"). Parts shorter than three letters are left, since they'd match ordinary words.
 * @param {string[]} people @param {string[]} [whole]
 */
export function namesToHide(people, whole = []) {
  const out = new Set();
  for (const raw of people) {
    const name = String(raw ?? "").trim();
    if (name.length < 3) continue;
    out.add(name);
    for (const part of name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s._-]+/)) if (part.length >= 3) out.add(part);
  }
  for (const raw of whole) {
    const name = String(raw ?? "").trim();
    if (name.length >= 3) out.add(name);
  }
  // Longest first, so "Lionel Lapidos" goes whole before "Lionel" alone.
  return [...out].sort((a, b) => b.length - a.length);
}

const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One piece of text with what could identify someone replaced.
 * @param {string} text @param {{ names?: string[], pc?: string }} [who] names as from namesToHide
 */
export function scrubText(text, { names = [], pc } = {}) {
  let s = String(text);
  s = s.replace(EMAIL, "<email>");
  s = s.replace(URL_PATH, "$1/<path>");
  s = s.replace(USER_DIR, "$1<user>");
  if (pc && pc.length >= 3) s = s.replace(new RegExp(`\\b${escape(pc)}\\b`, "gi"), "<pc>");
  for (const n of names) s = s.replace(new RegExp(`\\b${escape(n)}\\b`, "gi"), "<name>");
  s = s.replace(LONG_NUMBER, "<number>");
  s = s.replace(PHONE, (m) => (DATE.test(m.trim()) || (m.match(/\d/g) ?? []).length < 7 ? m : "<number>"));
  return s;
}

/**
 * A copy of a tree with every text field scrubbed. Structure, roles, refs, states and positions stay as they were.
 * @param {any} node @param {{ names?: string[], pc?: string }} [who]
 */
export function scrubTree(node, who = {}) {
  if (Array.isArray(node)) return node.map((n) => scrubTree(n, who));
  if (!node || typeof node !== "object") return node;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (TEXT_FIELDS.includes(k) && typeof v === "string") out[k] = scrubText(v, who);
    else if (k === "children") out[k] = scrubTree(v, who);
    else out[k] = v;
  }
  return out;
}
