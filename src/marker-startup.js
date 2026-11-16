/** Race work against cancellation, consuming late completions and rejections. */
export function abortable(work, signal) {
  if (!signal) return Promise.resolve().then(work);
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener("abort", stop); reject(signal.reason); };
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason;
      return work();
    }).then((value) => { signal.removeEventListener("abort", stop); resolve(value); },
      (err) => { signal.removeEventListener("abort", stop); reject(err); });
  });
}

/** Prepare the hidden renderer and the current capture concurrently, with one deadline. */
export async function prepareMarker({ capture, load, signal, timeoutMs = 10000 }) {
  const deadline = new AbortController();
  const combined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(new DOMException("The screen took too long. Try Mark again.", "TimeoutError")), timeoutMs);
  const start = performance.now();
  let captureMs = 0, loadMs = 0;
  try {
    const [image] = await Promise.all([
      abortable(async () => { const image = await capture(combined); captureMs = performance.now() - start; return image; }, combined),
      abortable(async () => { await load(combined); loadMs = performance.now() - start; }, combined),
    ]);
    return { image, captureMs, loadMs, totalMs: performance.now() - start };
  } finally {
    clearTimeout(timer);
    deadline.abort();
  }
}
