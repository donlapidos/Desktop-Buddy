// The marker (marker.html): the still of the screen the user draws on, their strokes, Undo, and the image sent with
// their question. Type-checked with the rest of Buddy (tsconfig.json).
import { appendStrokePoint, pointerSamples } from "../marker-stroke.js";
const PEN = 18;
const MAX_IMAGE = 1600; // longest side, physical px, of the image sent with the question
const shot = /** @type {HTMLImageElement} */ (document.getElementById("shot"));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("ink"));
const ctx = canvas.getContext("2d");
const savedCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("saved-ink"));
const savedCtx = savedCanvas.getContext("2d");
const paths = new WeakMap();
const strokes = [];
let finished = false;
let live = null;
let queued = false;
let savedDirty = true;
let lastAccent = "";

// Smooth a pointer trail into curves through the midpoints, so strokes read as pen, not polyline.
function pathOf(pts) {
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y} l0.01 0`;
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${pts[i].x} ${pts[i].y} ${mx} ${my}`;
  }
  const last = pts.at(-1);
  return d + ` L${last.x} ${last.y}`;
}

// The accent comes from --buddy (chosen in Settings). The canvas and the cursor image need plain colours, so it is
// read and mixed here.
function accent() {
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--buddy").trim();
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x2f7aff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const tint = (alpha) => `rgba(${accent().join(", ")}, ${alpha})`;
const deep = () => `rgb(${accent().map((v) => Math.round(v * 0.78)).join(", ")})`;
function penCursor() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="9" fill="${tint(0.35)}" stroke="${deep()}" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5" fill="${deep()}"/></svg>`;
  canvas.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
}

function paint(c, list, liveStroke, colour = { ink: tint(0.36), live: tint(0.5), disc: deep() }) {
  c.lineCap = c.lineJoin = "round";
  c.lineWidth = PEN;
  for (const s of list) {
    c.strokeStyle = colour.ink;
    if (!paths.has(s)) paths.set(s, new Path2D(pathOf(s.points)));
    c.stroke(paths.get(s));
  }
  if (liveStroke) {
    c.strokeStyle = colour.live;
    c.stroke(new Path2D(pathOf(liveStroke.points)));
  }
  for (const s of list) {
    const { x, y } = s.points[0];
    c.beginPath();
    c.arc(x - 14, y - 14, 11, 0, Math.PI * 2);
    c.fillStyle = colour.disc;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = "#fff";
    c.stroke();
    c.lineWidth = PEN;
    c.fillStyle = "#fff";
    c.font = "700 13px 'Schibsted Grotesk', 'Segoe UI', sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(String(s.n), x - 14, y - 13.5);
  }
}

function render() {
  queued = false;
  const dpr = devicePixelRatio;
  const colour = { ink: tint(0.36), live: tint(0.5), disc: deep() };
  if (colour.disc !== lastAccent) { savedDirty = true; lastAccent = colour.disc; }
  if (savedDirty) {
    savedCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    savedCtx.clearRect(0, 0, innerWidth, innerHeight);
    paint(savedCtx, strokes, null, colour);
    savedDirty = false;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  paint(ctx, [], live, colour);
}
const schedule = (saved = false) => { savedDirty ||= saved; if (!queued) { queued = true; requestAnimationFrame(render); } };

function fit() {
  canvas.width = Math.round(innerWidth * devicePixelRatio);
  canvas.height = Math.round(innerHeight * devicePixelRatio);
  savedCanvas.width = canvas.width;
  savedCanvas.height = canvas.height;
  schedule(true);
}
addEventListener("resize", fit);
fit();

function update() {
  const n = strokes.length;
  document.getElementById("count").textContent = n ? t("{n} marked · keep going or ask", { n }) : t("Click something to explain it, or draw over things to ask");
  /** @type {HTMLButtonElement} */ (document.getElementById("undo")).disabled = !n;
  /** @type {HTMLButtonElement} */ (document.getElementById("ask")).disabled = !n;
  window.buddy.markCount(n);
}

canvas.addEventListener("pointerdown", (e) => {
  if (finished || live || e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  live = { pointerId: e.pointerId, points: [{ x: e.clientX, y: e.clientY }], at: performance.now() };
  schedule();
});
canvas.addEventListener("pointermove", (e) => {
  if (!live || e.pointerId !== live.pointerId) return;
  // Coalesced events carry every sample the OS saw between frames: smooth lines at any mouse speed.
  for (const ev of pointerSamples(e)) appendStrokePoint(live.points, { x: ev.clientX, y: ev.clientY });
  schedule();
});
// A quick click with nothing marked yet means "explain this": no drawing, no Enter.
const isClick = (s) => {
  const b = bboxOf(s.points, 0);
  return Math.hypot(b.r - b.x, b.b - b.y) < 6 && performance.now() - s.at < 500;
};
const endStroke = (e) => {
  if (!live || e.pointerId !== live.pointerId) return;
  appendStrokePoint(live.points, { x: e.clientX, y: e.clientY }, true);
  if (!strokes.length && !finished && isClick(live)) {
    finished = true;
    document.body.classList.add("done");
    window.buddy.markClick(live.points[0]);
    live = null;
    return;
  }
  strokes.push({ n: strokes.length + 1, points: live.points });
  live = null;
  schedule(true);
  update();
};
canvas.addEventListener("pointerup", endStroke);
const cancelStroke = (e) => {
  if (!live || e.pointerId !== live.pointerId) return;
  live = null;
  schedule();
};
canvas.addEventListener("pointercancel", cancelStroke);
canvas.addEventListener("lostpointercapture", cancelStroke);

function undo() {
  if (live || !strokes.length) return;
  strokes.pop();
  schedule(true);
  update();
}

const bboxOf = (pts, pad) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, r: Math.max(...xs) + pad, b: Math.max(...ys) + pad };
};

// The image sent with the question: the marked area of the still, padded for context, strokes drawn on.
function compose() {
  const sf = shot.naturalWidth / innerWidth;
  const W = shot.naturalWidth, H = shot.naturalHeight;
  const boxes = strokes.map((s) => bboxOf(s.points, PEN));
  const u = { x: Math.min(...boxes.map((b) => b.x)) * sf, y: Math.min(...boxes.map((b) => b.y)) * sf,
              r: Math.max(...boxes.map((b) => b.r)) * sf, b: Math.max(...boxes.map((b) => b.b)) * sf };
  const w = Math.min(W, Math.max(u.r - u.x + 240 * sf, 900));
  const h = Math.min(H, Math.max(u.b - u.y + 200 * sf, 600));
  const sx = Math.round(Math.min(Math.max((u.x + u.r) / 2 - w / 2, 0), W - w));
  const sy = Math.round(Math.min(Math.max((u.y + u.b) / 2 - h / 2, 0), H - h));
  const k = Math.min(1, MAX_IMAGE / Math.max(w, h));
  const out = document.createElement("canvas");
  out.width = Math.round(w * k);
  out.height = Math.round(h * k);
  const c = out.getContext("2d");
  c.drawImage(shot, sx, sy, w, h, 0, 0, out.width, out.height);
  c.setTransform(sf * k, 0, 0, sf * k, -sx * k, -sy * k);
  paint(c, strokes, null);
  return out.toDataURL("image/png").split(",")[1];
}

function finish() {
  if (finished || live) return;
  if (!strokes.length) return window.buddy.markCancel();
  finished = true;
  const image = compose();
  document.body.classList.add("done");
  window.buddy.markFinish({ image, strokes: strokes.map((s) => ({ n: s.n, points: s.points })) });
}

document.getElementById("undo").addEventListener("click", undo);
document.getElementById("ask").addEventListener("click", finish);
document.getElementById("cancel").addEventListener("click", () => window.buddy.markCancel());
addEventListener("keydown", (e) => {
  if (e.key === "Enter") finish();
  else if (e.key === "Escape") window.buddy.markCancel();
  else if ((e.ctrlKey && e.key.toLowerCase() === "z") || e.key === "Backspace") undo();
});
addEventListener("contextmenu", (e) => { e.preventDefault(); undo(); });

window.buddy.onMarkStart(({ png }) => {
  shot.onload = () => { fit(); penCursor(); window.buddy.markReady(); };
  shot.src = URL.createObjectURL(new Blob([png], { type: "image/png" }));
});
window.buddy.onMarkCommand((cmd) => (cmd === "done" ? finish() : cmd === "undo" ? undo() : null));
// Dev hook: strokes injected by main (BUDDY_MARK_TEST), drawn as if by hand, then asked.
window.buddy.onMarkInject((list) => {
  for (const points of list) strokes.push({ n: strokes.length + 1, points });
  schedule(true);
  update();
  setTimeout(finish, 300);
});

// The words in this window's language, now and whenever it changes.
whenStrings(update);
