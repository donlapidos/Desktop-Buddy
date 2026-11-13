// Read the requested window and capture it in parallel. One unavailable source must not prevent the other from
// helping, and even an uncooperative capture must not hold up cancellation or the first model call indefinitely.
/** @typedef {{ type: "image", source: { type: "base64", media_type: "image/png" | "image/jpeg", data: string } }} ScreenImage */

/**
 * @param {{ read: (signal: AbortSignal) => Promise<string | null>, capture: (signal: AbortSignal) => Promise<ScreenImage | null>,
 *   includeImage: boolean, signal: AbortSignal, budgetMs?: number }} options
 * @returns {Promise<{ reading: string | null, image: ScreenImage | null }>}
 */
export async function collectScreenContext({ read, capture, includeImage, signal, budgetMs = 4000 }) {
  if (signal.aborted) return { reading: null, image: null };
  const deadline = new AbortController();
  const combined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), budgetMs);
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
    const [reading, image] = await Promise.all([settle(read), includeImage ? settle(capture) : Promise.resolve(null)]);
    return signal.aborted ? { reading: null, image: null } : { reading, image };
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}
