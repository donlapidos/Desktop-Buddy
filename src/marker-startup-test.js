// Exercise the real Mark lifecycle with generated pixels and test-owned windows.
// Every capture is injected: this check never calls desktopCapturer or a model.
import { nativeImage, screen } from "electron";

export async function runMarkerStartupTest({ start, cancel, retire, window, mode, captureFrame, activeCaptures }) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (check) => {
    for (const end = Date.now() + 10000; Date.now() < end; await wait(20)) if (check()) return;
    throw new Error("Marker startup did not reach its expected state");
  };
  const gate = () => { let resolve = (_value) => {}; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  const display = { ...screen.getPrimaryDisplay(), bounds: { x: 80, y: 100, width: 800, height: 500 }, size: { width: 800, height: 500 } };
  const image = nativeImage.createFromBitmap(Buffer.from([240, 244, 242, 255]), { width: 1, height: 1 });
  const old = gate();
  const a = gate(), b = gate();
  let first, second;
  const abortA = new AbortController(), abortB = new AbortController();
  const result = {};
  try {
    let captureStarted = false, loaded = false;
    first = start({ display, capture: async () => { captureStarted = true; return old.promise; } });
    const previous = window();
    if (!previous) throw new Error("Mark didn't create its hidden window during capture");
    previous.webContents.once("did-finish-load", () => { loaded = true; });
    await until(() => captureStarted && loaded);
    result.loadedDuringCapture = !previous.isVisible() && mode() === "marking";
    retire(150);
    await first;
    result.cancelledPromptly = mode() === "idle";
    second = start({ display, capture: async () => image });
    const current = window();
    if (!current || current === previous) throw new Error("Mark didn't create a replacement window");
    old.resolve(image);
    await second;
    await until(() => previous.isDestroyed() && current.isVisible());
    result.replacementSurvived = window() === current && mode() === "marking";
    result.imageReady = await current.webContents.executeJavaScript("document.getElementById('shot').naturalWidth === 1");
    cancel();
    await until(() => current.isDestroyed());
    result.closed = window() === null && mode() === "idle";
    await start({ display, capture: async () => nativeImage.createEmpty(), timeoutMs: 1000 });
    await until(() => mode() === "idle" && window() === null);
    result.unreadyRecovered = true;

    let sources = 0;
    const source = (gate) => async () => { sources++; return gate.promise; };
    const firstCapture = captureFrame(display, abortA.signal, source(a)).then(() => false, (err) => err.name === "AbortError");
    const secondCapture = captureFrame(display, abortB.signal, source(b));
    await until(() => sources === 2);
    result.sharedCaptureStarted = activeCaptures() === 2;
    abortA.abort();
    result.captureCancelled = await firstCapture;
    result.newCaptureStillHidden = activeCaptures() === 1;
    const sample = [{ display_id: String(display.id), thumbnail: image }];
    a.resolve(sample); await wait(30);
    result.lateCaptureIgnored = activeCaptures() === 1;
    b.resolve(sample); await secondCapture;
    result.captureReleased = activeCaptures() === 0;
    try {
      await captureFrame(display, undefined, async () => [{ display_id: "another-display", thumbnail: image }]);
      result.missingDisplayRejected = false;
    } catch (err) { result.missingDisplayRejected = /isn't available/.test(err.message) && activeCaptures() === 0; }
    console.log("MARK_STARTUP_TEST", JSON.stringify(result));
  } catch (err) { console.log("MARK_STARTUP_TEST", JSON.stringify({ ...result, error: String(err?.message ?? err) })); }
  finally {
    old.resolve(image); a.resolve([]); b.resolve([]); abortA.abort(); abortB.abort(); cancel();
    console.log("MARK_STARTUP_TEST_DONE");
  }
}
