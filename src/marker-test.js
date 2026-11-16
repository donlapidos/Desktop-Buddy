// Renderer-only checks over a generated sample, never the owner's screen or mouse.
import { BrowserWindow, ipcMain, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";

function sampleImage() {
  const surface = document.createElement("canvas");
  surface.width = 1280; surface.height = 800;
  const c = surface.getContext("2d");
  c.fillStyle = "#f2f4f0"; c.fillRect(0, 0, 1280, 800);
  c.fillStyle = "#fff"; c.fillRect(100, 150, 1080, 540);
  c.fillStyle = "#1a201c"; c.font = "600 28px Segoe UI"; c.fillText("Sample budget", 140, 210);
  c.font = "18px Segoe UI";
  ["Category", "Budget", "Spent", "Left"].forEach((text, i) => c.fillText(text, 150 + i * 245, 280));
  [["Rent", "1,200", "1,200", "0"], ["Food", "400", "455", "−55"], ["Travel", "150", "90", "60"]].forEach((row, j) => {
    row.forEach((text, i) => c.fillText(text, 150 + i * 245, 350 + j * 85));
    c.fillStyle = "#cfd5cd"; c.fillRect(140, 374 + j * 85, 1000, 1); c.fillStyle = "#1a201c";
  });
  return surface.toDataURL("image/png").split(",")[1];
}

async function exerciseMarker() {
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("ink"));
  // Synthetic DOM input stays inside this hidden test window. Pointer capture
  // requires a native pointer, so emulate just that bookkeeping for these events.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => true;
  const raf = window.requestAnimationFrame.bind(window);
  const frame = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Marker frame did not paint")), 1000);
    raf(() => { clearTimeout(timer); resolve(); });
  });
  const pointer = (type, x, y, id = 1, empty = false) => {
    const event = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, bubbles: true });
    Object.defineProperty(event, "getCoalescedEvents", { value: () => empty ? [] : [event] });
    return canvas.dispatchEvent(event);
  };
  const draw = async (y, points = 64) => {
    pointer("pointerdown", 160, y);
    for (let i = 1; i <= points; i++) pointer("pointermove", 160 + i * 5, y + Math.sin(i / 7) * 12);
    pointer("pointerup", 160 + points * 5, y);
    await frame();
  };
  for (let i = 0; i < 20; i++) await draw(230 + i * 19);
  const times = [];
  let strokes = 0;
  const originalRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) => raf((time) => { const start = performance.now(); callback(time); times.push(performance.now() - start); });
  for (const node of Array.from(document.querySelectorAll("canvas"))) {
    const context = node.getContext("2d");
    const stroke = context.stroke.bind(context);
    context.stroke = (...args) => { strokes++; return stroke(...args); };
  }
  pointer("pointerdown", 150, 650);
  for (let i = 0; i < 30; i++) {
    for (let j = 0; j < 8; j++) pointer("pointermove", 150 + (i * 8 + j) * 3, 650 + Math.sin((i * 8 + j) / 9) * 15);
    await frame();
  }
  const pixel = (node, x, y) => node.getContext("2d").getImageData(Math.round(x * node.width / innerWidth), Math.round(y * node.height / innerHeight), 1, 1).data[3];
  const liveVisible = pixel(canvas, 867, 650 + Math.sin(239 / 9) * 15) > 0;
  pointer("pointerup", 880, 650); await frame();
  const saved = /** @type {HTMLCanvasElement} */ (document.getElementById("saved-ink"));
  const savedVisible = !!saved && pixel(saved, 880, 650) > 0;
  const activeCleared = pixel(canvas, 880, 650) === 0;
  window.requestAnimationFrame = originalRAF;
  const strokeCalls = strokes;
  const countBeforeCancel = document.getElementById("count").textContent;
  pointer("pointerdown", 900, 600, 2);
  pointer("pointermove", 1000, 640, 2);
  pointer("pointercancel", 1000, 640, 2); await frame();
  const cancelDiscarded = document.getElementById("count").textContent === countBeforeCancel;
  pointer("pointerdown", 100, 700, 3);
  pointer("pointermove", 140, 740, 3, true);
  pointer("pointerup", 200, 700, 3); await frame();
  pointer("pointerdown", 60, 600, 4);
  for (let i = 1; i <= 6000; i++) pointer("pointermove", 60 + (i % 500) * 2, 600 + (Math.floor(i / 500) % 4) * 5, 4);
  pointer("pointerup", 1100, 740, 4); await frame();
  const beforeOtherPointer = document.getElementById("count").textContent;
  pointer("pointerdown", 300, 620, 5);
  pointer("pointermove", 1100, 750, 6);
  pointer("pointerup", 1100, 750, 6);
  const pointerIsolated = document.getElementById("count").textContent === beforeOtherPointer;
  pointer("pointermove", 400, 620, 5); pointer("pointerup", 400, 620, 5); await frame();
  document.getElementById("undo").click(); await frame();
  const undoWorked = document.getElementById("count").textContent === beforeOtherPointer;
  times.sort((a, b) => a - b);
  return { dpr: devicePixelRatio, canvasScale: canvas.width / innerWidth, frames: times.length,
    medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.floor(times.length * .95)], strokeCalls, cancelDiscarded, pointerIsolated, undoWorked,
    liveVisible, savedVisible, activeCleared };
}

export async function runMarkerTest({ here, out }) {
  let win;
  try {
    const results = [];
    for (const dpr of [1, 2]) {
      win = new BrowserWindow({ width: 1280, height: 800, show: false, frame: false, paintWhenInitiallyHidden: true, webPreferences: {
        preload: path.join(here, "preload.cjs"), backgroundThrottling: false,
      } });
      await win.loadFile(path.join(here, "ui/marker.html"));
      win.webContents.enableDeviceEmulation({ screenPosition: "desktop", screenSize: { width: 1280, height: 800 }, viewPosition: { x: 0, y: 0 }, viewSize: { width: 1280, height: 800 }, deviceScaleFactor: dpr, scale: 1 });
      win.showInactive();
      const png = await win.webContents.executeJavaScript(`(${sampleImage.toString()})()`);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ipcMain.removeListener("mark-ready", ready); reject(new Error("Marker did not load its sample")); }, 10000);
        const ready = (event) => { if (event.sender !== win.webContents) return; clearTimeout(timer); ipcMain.removeListener("mark-ready", ready); resolve(); };
        ipcMain.on("mark-ready", ready);
        win.webContents.send("mark-start", { png: Buffer.from(png, "base64") });
      });
      const result = await win.webContents.executeJavaScript(`(${exerciseMarker.toString()})()`);
      // capturePage can read the previous compositor frame even after canvas's
      // pixels changed. Let the final Undo reach the compositor before the artifact.
      await win.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      if (dpr === 1) fs.writeFileSync(path.join(out, "marker-render.png"), (await win.webContents.capturePage()).toPNG());
      const finished = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ipcMain.removeListener("mark-finish", done); reject(new Error("Marker did not compose its sample")); }, 10000);
        const done = (event, payload) => { if (event.sender !== win.webContents) return; clearTimeout(timer); ipcMain.removeListener("mark-finish", done); resolve(payload); };
        ipcMain.on("mark-finish", done);
      });
      await win.webContents.executeJavaScript("document.getElementById('ask').click()");
      const payload = /** @type {any} */ (await finished);
      const long = payload.strokes.at(-1);
      result.tipTracked = long.points.at(-1).x === 1100 && long.points.at(-1).y === 740;
      result.pointsBounded = payload.strokes.every((s) => s.points.length <= 4000);
      result.coalescedFallback = payload.strokes.some((s) => s.points.some((p) => p.x === 140 && p.y === 740));
      result.composed = typeof payload.image === "string" && payload.image.length > 1000;
      const image = nativeImage.createFromBuffer(Buffer.from(payload.image, "base64"));
      const bitmap = image.toBitmap();
      let blue = 0;
      for (let i = 0; i < bitmap.length; i += 16) if (bitmap[i] > bitmap[i + 2] * 1.1 && bitmap[i] > bitmap[i + 1] * 1.05) blue++;
      result.composedMarksVisible = blue > 50 && Math.max(image.getSize().width, image.getSize().height) <= 1600;
      results.push(result);
      win.destroy(); win = null;
    }
    console.log("MARK_RENDER_TEST", JSON.stringify({ results }));
  } catch (err) { console.log("MARK_RENDER_TEST", JSON.stringify({ error: String(err?.message ?? err) })); }
  finally { if (win && !win.isDestroyed()) win.destroy(); console.log("MARK_RENDER_TEST_DONE"); }
}
