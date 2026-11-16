// How models have done on Buddy's own checks (npm run eval), and the bar for calling one "works well". Settings marks
// a model "works well" only when it passed this bar here, or in the user's own "Check this model" run: being able to
// use tools and see images (providers.js verdict) is what a model can do, not how well it does it.

/** The share of tasks a model must pass, over every set it was run on, to be marked "works well". */
export const WORKS_WELL_BAR = 0.9;

/**
 * Results of `npm run eval` runs, newest last. Add a row per run (`--json` saves what goes in it); keep the date.
 * `costPerTask` is US dollars, or null when the provider's prices aren't in costs.js.
 * @typedef {{ provider: string, model: string, set: "real" | "workflows" | "sample", passed: number, total: number, avgMs: number, costPerTask: number | null, at: string }} Measured
 * @type {readonly Measured[]}
 */
export const MEASURED = Object.freeze([
  // e2e-out/workflow-lean-2026-11-16.json (the owner's run).
  { provider: "openai", model: "gpt-6.1-sol", set: "workflows", passed: 6, total: 6, avgMs: 4390, costPerTask: null, at: "2026-11-16" },
]);

/** A model's measured results, all sets added up, with the newest date; null if it hasn't been run. */
export function measured(/** @type {string} */ provider, /** @type {string} */ model, rows = MEASURED) {
  const mine = rows.filter((r) => r.provider === provider && r.model === model);
  if (!mine.length) return null;
  const total = mine.reduce((n, r) => n + r.total, 0);
  return {
    passed: mine.reduce((n, r) => n + r.passed, 0),
    total,
    avgMs: Math.round(mine.reduce((n, r) => n + r.avgMs * r.total, 0) / total),
    at: mine.map((r) => r.at).sort().at(-1) ?? "",
  };
}

/** Whether a share of passed tasks clears the bar. */
export const clearsBar = (/** @type {{ passed: number, total: number } | null | undefined} */ r) => !!r && r.total > 0 && r.passed / r.total >= WORKS_WELL_BAR;

/**
 * Whether Settings may mark this model "works well": measured here, or by the user's own check (`tested`), at or
 * above the bar. Its family's name alone never does.
 * @param {string} provider @param {string} model @param {{ passed: number, total: number } | null} [tested]
 */
export function worksWell(provider, model, tested = null, rows = MEASURED) {
  return clearsBar(measured(provider, model, rows)) || clearsBar(tested);
}
