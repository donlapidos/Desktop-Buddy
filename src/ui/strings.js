// Buddy's words in the user's language, for its pages (src/i18n.js has the whole story). Loaded before each page's
// own script. Words in the page itself are marked: data-t on an element translates its text, data-t-attrs="title,
// placeholder" its attributes. Words a script writes go through t(). When the language changes, the marked words
// change at once, and whenStrings lets a page redraw what its script wrote.
let STRINGS = {};
let stringsReady = false;
/** @type {(() => void)[]} */
const stringsListeners = [];

/**
 * Runs `fn` once the words have arrived (now, if they have) and again each time the language changes. The words can
 * arrive before a page's own script has loaded, so a page never waits for an event it may have missed.
 * @param {() => void} fn
 */
function whenStrings(fn) {
  stringsListeners.push(fn);
  if (stringsReady) fn();
}

/** The words in the current language, with {name} filled in from `vars`. @param {string} text @param {Record<string, string | number>} [vars] */
function t(text, vars) {
  const s = STRINGS[text] || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : s;
}

/** Marks English to be translated where it's shown (with t), not where it's defined. @param {string} text */
const N = (text) => text;

/** Translates the marked words in `root`, from the English each started with. @param {ParentNode} [root] */
function applyStrings(root = document) {
  for (const node of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll("[data-t]"))) {
    node.dataset.en ??= node.textContent.trim();
    node.textContent = t(node.dataset.en);
  }
  for (const node of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll("[data-t-attrs]"))) {
    for (const attr of node.dataset.tAttrs.split(",").map((a) => a.trim())) {
      const key = `en${attr.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase())}`;
      node.dataset[key] ??= node.getAttribute(attr) ?? "";
      if (node.dataset[key]) node.setAttribute(attr, t(node.dataset[key]));
    }
  }
}

function useStrings(/** @type {{ lang: string, table: Record<string, string> }} */ s) {
  STRINGS = s?.table ?? {};
  document.documentElement.lang = s?.lang ?? "en";
  applyStrings();
  stringsReady = true;
  for (const fn of stringsListeners) fn();
}
window.buddy.strings().then(useStrings);
window.buddy.onStrings(useStrings);
