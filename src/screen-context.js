// Read the requested window and capture it in parallel. One unavailable source must not prevent the other from
// helping, and even an uncooperative capture must not hold up cancellation or the first model call indefinitely.
/** @typedef {{ type: "image", source: { type: "base64", media_type: "image/png" | "image/jpeg", data: string } }} ScreenImage */

// Only fast-track explicit requests to locate one named control. Unknown question
// shapes, missing or duplicate controls, charts and other visual tasks keep the full budget.
function treeAnswers(question, reading) {
  if (!reading?.startsWith("window:")) return false;
  const asked = /^(?:where (?:is|can i find)|(?:please )?(?:point (?:me )?to|show me|find))\s+(?:the\s+)?(.+?)[?!.]*$/i.exec(question.trim());
  if (!asked) return false;
  const target = asked[1].toLowerCase().replace(/["“”]/g, "");
  let matches = 0;
  for (const line of reading.split("\n").slice(1)) {
    const control = /^\s*\S+\s+(button|tab|menuitem|menu item|checkbox|combobox|link|option|radio button)\s+"([^"]+)"/i.exec(line);
    if (!control || /\[(?:[^\]]*,)?(?:offscreen|disabled)(?:,|\])/.test(line)) continue;
    const label = control[2].toLowerCase();
    if (target === label || target === label + " " + control[1].toLowerCase()) matches++;
  }
  return matches === 1;
}

/**
 * @param {{ read: (signal: AbortSignal) => Promise<string | null>, capture: (signal: AbortSignal) => Promise<ScreenImage | null>,
 *   includeImage: boolean, signal: AbortSignal, budgetMs?: number, question?: string }} options
 * @returns {Promise<{ reading: string | null, image: ScreenImage | null }>}
 */
export async function collectScreenContext({ read, capture, includeImage, signal, budgetMs = 4000, question = "" }) {
  if (signal.aborted) return { reading: null, image: null };
  const deadline = new AbortController();
  const combined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), budgetMs);
  let grace;
  // The race also handles readers which don't yet support AbortSignal. Their late results are never published.
  /** @template T @param {(signal: AbortSignal) => Promise<T>} work @returns {Promise<T | null>} */
  function settle(work) {
    return new Promise((resolve) => {
      const abort = () => resolve(null);
      combined.addEventListener("abort", abort, { once: true });
      if (combined.aborted) { combined.removeEventListener("abort", abort); return resolve(null); }
      Promise.resolve().then(() => combined.aborted ? null : work(combined)).then(
        (value) => resolve(combined.aborted ? null : value),
        () => resolve(null),
      ).finally(() => combined.removeEventListener("abort", abort));
    });
  }
  try {
    const text = settle(read).then(reading => {
      if (includeImage && question && treeAnswers(question, reading)) grace = setTimeout(() => deadline.abort(), 200);
      return reading;
    });
    const [reading, image] = await Promise.all([text, includeImage ? settle(capture) : Promise.resolve(null)]);
    return signal.aborted ? { reading: null, image: null } : { reading, image };
  } finally {
    clearTimeout(timer);
    clearTimeout(grace);
    deadline.abort();
  }
}
