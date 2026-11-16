// Ask-to-pointer timing: how long a question takes to put Buddy's pointer (or a guide's first highlight) on screen,
// the number every speed change is judged by. One `first-pointer` entry per question in timing.log, split into its
// parts, with no window text or image data. `npm run measure:latency` summarises a log (summarizeLatency).

/** Fields of a first-pointer entry that are milliseconds, in the order they are reported. */
export const LATENCY_FIELDS = /** @type {const} */ (["ms", "contextMs", "modelMs", "pointMs", "heardMs", "firstAudioMs"]);

// A spoken answer may start talking only after the pointer is up (its closing line); wait this long for that.
const AUDIO_WAIT_MS = 10_000;

/**
 * One question's clock. `at` is when it was accepted: Send pressed, or (for a spoken question) the end of speech, in
 * which case `heardMs` is how long speech-to-text took. The Brain adds the parts as they happen; the entry is written
 * once, by finish(), and only if a pointer was shown.
 * @param {{ write: (entry: object) => void, voice?: boolean, at?: number, heardMs?: number, provider?: string, model?: string, now?: () => number }} o
 */
export function questionTiming({ write, voice = false, at, heardMs, provider, model, now = Date.now }) {
  const start = at ?? now();
  const parts = { contextMs: 0, modelMs: 0 };
  /** @type {{ ms: number, pointMs: number } | null} */
  let pointer = null;
  /** @type {number | null} */
  let audio = null;
  let finished = false;
  let written = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let audioTimer;

  const flush = () => {
    if (written || !pointer) return;
    written = true;
    clearTimeout(audioTimer);
    write({ kind: "first-pointer", ms: pointer.ms, contextMs: parts.contextMs, modelMs: parts.modelMs, pointMs: pointer.pointMs,
      voice, provider, model, ...(voice && heardMs != null ? { heardMs } : {}), ...(voice && audio != null ? { firstAudioMs: audio } : {}) });
  };

  return {
    /** Time spent reading the window or waiting on the model, before the pointer is up. @param {"contextMs" | "modelMs"} part @param {number} ms */
    add(part, ms) {
      if (!pointer) parts[part] += Math.max(0, Math.round(ms));
    },
    /** The pointer or first highlight is on screen; `pointMs` is how long its tool took to get it there. */
    pointed(/** @type {number} */ pointMs) {
      if (pointer) return;
      pointer = { ms: now() - start, pointMs: Math.max(0, Math.round(pointMs)) };
      if (finished) flush();
    },
    get hasPointed() {
      return !!pointer;
    },
    /** Buddy made its first sound for this question. */
    audio() {
      if (audio != null || !voice) return;
      audio = now() - start;
      if (finished) flush();
    },
    /** The answer ended. A spoken one waits a moment for its first sound; the entry is written then. */
    finish({ waitForAudio = false } = {}) {
      if (finished) return;
      finished = true;
      if (!voice || audio != null || !waitForAudio) return flush();
      audioTimer = setTimeout(flush, AUDIO_WAIT_MS);
    },
  };
}

/** @typedef {ReturnType<typeof questionTiming>} QuestionTiming */

/** The value at fraction `q` of sorted numbers (nearest rank). @param {number[]} sorted @param {number} q */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

/**
 * Count, median and p90 of each field of the first-pointer entries in `lines` (timing.log's JSON lines), per model,
 * typed and spoken apart. Lines that aren't first-pointer entries, or aren't JSON, are skipped.
 * @param {string[]} lines
 * @returns {{ model: string, voice: boolean, count: number, fields: Record<string, { count: number, median: number | null, p90: number | null }> }[]}
 */
export function summarizeLatency(lines) {
  /** @type {Map<string, { model: string, voice: boolean, entries: any[] }>} */
  const groups = new Map();
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e?.kind !== "first-pointer" || !Number.isFinite(e.ms)) continue;
    const model = `${e.provider ?? "?"}/${e.model ?? "?"}`;
    const key = `${model}|${!!e.voice}`;
    if (!groups.has(key)) groups.set(key, { model, voice: !!e.voice, entries: [] });
    groups.get(key)?.entries.push(e);
  }
  return [...groups.values()].sort((a, b) => a.model.localeCompare(b.model) || Number(a.voice) - Number(b.voice)).map(({ model, voice, entries }) => ({
    model,
    voice,
    count: entries.length,
    fields: Object.fromEntries(LATENCY_FIELDS.map((f) => {
      const values = entries.map((e) => e[f]).filter(Number.isFinite).sort((a, b) => a - b);
      return [f, { count: values.length, median: quantile(values, 0.5), p90: quantile(values, 0.9) }];
    })),
  }));
}
