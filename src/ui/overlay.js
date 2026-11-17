// The overlay (overlay.html), one per display, click-through: Buddy's pointer and caption, and the marks the user
// drew, kept on screen while they ask about them. Drawings are annotations.js. A classic script, not a module.
// Type-checked with the rest of Buddy (tsconfig.json).
// ---------- Marks: what the user highlighted stays on screen while they ask about it ----------
// (Drawing happens in marker.html; this only shows the finished strokes.)
const SVG = "http://www.w3.org/2000/svg";
const ink = document.getElementById("ink");

const el = (name, attrs) => {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
// Same curve smoothing as marker.html, so the marks look identical after the still closes.
function pathOf(pts) {
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y} l0.01 0`;
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    d += ` Q${pts[i].x} ${pts[i].y} ${(pts[i].x + pts[i + 1].x) / 2} ${(pts[i].y + pts[i + 1].y) / 2}`;
  }
  return d + ` L${pts.at(-1).x} ${pts.at(-1).y}`;
}

function drawStroke(points, n) {
  ink.appendChild(el("path", { d: pathOf(points), class: "stroke" }));
  const { x, y } = points[0];
  ink.appendChild(el("circle", { cx: x - 14, cy: y - 14, r: 11, class: "disc" }));
  const t = el("text", { x: x - 14, y: y - 9.5, class: "n" });
  t.textContent = n;
  ink.appendChild(t);
}

window.buddy.onMarksClear(() => ink.replaceChildren());
window.buddy.onMarkDrawn(({ points, n }) => drawStroke(points, n));

window.buddy.onHideBuddy((hidden) => document.body.classList.toggle("hide-buddy", hidden));
const buddyEl = document.getElementById("buddy");
const ring = document.getElementById("ring");
const caption = document.getElementById("caption");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const pos = { x: -100, y: -100 };
let mode = "follow";          // follow the real cursor, or fly to a target
let follow = null;            // latest cursor point on this display
let flight = null;            // { from, to, start, duration }
let captionTimer = null;

// Frames run only while the pointer is moving (flying to a target or catching up with the cursor). A loop that
// ran forever kept this full-screen window repainting and cost a few percent of a core with nothing happening.
let raf = 0;
const wake = () => {
  if (!raf) raf = requestAnimationFrame(frame);
};

window.buddy.onCursor((p) => {
  follow = p;
  if (mode === "follow") buddyEl.style.opacity = p ? "1" : "0";
  wake();
});

window.buddy.onPoint(({ rect, caption: text, decorate = true, guess = false }) => {
  ring.classList.toggle("guess", guess);
  clearTimeout(captionTimer);
  mode = "point";
  const to = { x: rect.x + rect.width / 2 - 4, y: rect.y + rect.height / 2 - 2 };
  flight = { from: { ...pos }, to, start: performance.now(), duration: reduceMotion ? 0 : 650 };
  buddyEl.style.opacity = "1";
  Object.assign(ring.style, { left: rect.x - 6 + "px", top: rect.y - 6 + "px", width: rect.width + 8 + "px", height: rect.height + 8 + "px" });
  ring.classList.toggle("on", decorate);
  caption.textContent = text;
  caption.classList.remove("on");
  wake();
  captionTimer = setTimeout(() => {
    if (!text || !decorate) return;
    const right = to.x + 300 < innerWidth;
    caption.style.left = (right ? to.x + 22 : to.x - Math.min(260, caption.offsetWidth) - 10) + "px";
    caption.style.top = Math.min(to.y + 18, innerHeight - 60) + "px";
    caption.classList.add("on");
  }, flight.duration);
});

window.buddy.onRelease(() => {
  clearTimeout(captionTimer);
  mode = "follow";
  ring.classList.remove("on");
  caption.classList.remove("on");
  if (!follow) buddyEl.style.opacity = "0";
  wake();
});

const ease = (t) => 1 - Math.pow(1 - t, 3);

function frame(now) {
  raf = 0;
  let moving = false;
  if (mode === "point" && flight) {
    const t = flight.duration ? Math.min(1, (now - flight.start) / flight.duration) : 1;
    const k = ease(t);
    // Arc gently on the way, like something flying rather than sliding.
    const lift = Math.sin(Math.PI * k) * Math.min(80, Math.hypot(flight.to.x - flight.from.x, flight.to.y - flight.from.y) * 0.18);
    pos.x = flight.from.x + (flight.to.x - flight.from.x) * k;
    pos.y = flight.from.y + (flight.to.y - flight.from.y) * k - lift;
    moving = t < 1;
  } else if (follow) {
    const tx = follow.x + 16, ty = follow.y + 14;   // sit just beside the real pointer
    // Easing never quite arrives, so land exactly once within a fraction of a pixel; then the loop can stop.
    if (Math.abs(tx - pos.x) < 0.3 && Math.abs(ty - pos.y) < 0.3) {
      pos.x = tx;
      pos.y = ty;
    } else {
      pos.x += (tx - pos.x) * 0.25;
      pos.y += (ty - pos.y) * 0.25;
      moving = true;
    }
  }
  buddyEl.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  if (moving) wake();
}
wake();
