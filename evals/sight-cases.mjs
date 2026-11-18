// Pointing by sight (BUILD-PLAN package 7): screens where the accessibility tree names nothing useful (a paint canvas,
// a scanned PDF, a remote desktop, a chart picture, a game menu, and small targets in a design tool, a 3D viewport and
// a layers panel). Buddy gets the picture and an all but empty tree, and passes a case when it points (or circles)
// inside the box of what was asked about. The share passed is the model's hit rate.
// Run: npm run eval -- --provider <id> --model <id> --set sight
// The pictures are made by scripts/make-sight-screens.cjs, which also writes screens.json (sizes, boxes, questions).
import fs from "node:fs";

const screens = JSON.parse(fs.readFileSync(new URL("./screens/screens.json", import.meta.url), "utf8"));

/** @typedef {import("../src/evals.js").Call} Call */

/** Every spot Buddy showed: point_at's, and those in annotate's items. @param {Call[]} calls */
export const spotsShown = (calls) => calls.flatMap((c) => [c.input?.spot, ...(Array.isArray(c.input?.items) ? c.input.items.map((i) => i?.spot) : [])]).filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.y));

/**
 * Passes when a spot Buddy showed (pixels on the picture, as the model was given it) lands inside `box`, and nothing
 * was done. @param {{ x: number, y: number, width: number, height: number }} box
 */
export const spotIn = (box) => (/** @type {Call[]} */ calls) => {
  if (calls.some((c) => c.kind === "act")) return "acted instead of showing";
  const spots = spotsShown(calls);
  if (!spots.length) return "didn't point at anything on the picture";
  const inside = (s) => s.x >= box.x && s.x <= box.x + box.width && s.y >= box.y && s.y <= box.y + box.height;
  if (spots.some(inside)) return null;
  return `pointed at ${spots.map((s) => `(${Math.round(s.x)}, ${Math.round(s.y)})`).join(", ")}, outside the box at (${box.x}, ${box.y}) ${box.width}x${box.height}`;
};

const TITLES = {
  "paint-canvas": ["Paint: find the eraser", "mspaint.exe", "Untitled - Paint"],
  "pdf-scan": ["A scanned PDF: where to sign", "msedge.exe", "permission-form.pdf"],
  "remote-desktop": ["Remote Desktop: the remote Recycle Bin", "mstsc.exe", "office-pc - Remote Desktop Connection"],
  "chart-image": ["A chart picture: the best month", "msedge.exe", "visitors.png"],
  "game-menu": ["A game: its settings", "starfarm.exe", "Star Farm"],
  "design-toolbar": ["A design app: the pen tool", "Figma.exe", "Sign-up flow - Figma"],
  "3d-viewport": ["A 3D app: look through the camera", "blender.exe", "Blender"],
  "layers-panel": ["A photo editor: hide a layer", "PhotoEditor.exe", "summer-poster.psd"],
};

/** @type {import("../src/evals.js").EvalCase[]} */
export const SIGHT_CASES = Object.entries(screens).map(([name, s]) => {
  const [title, app, windowName] = TITLES[name];
  return {
    id: `sight-${name}`,
    title,
    app,
    // All the tree has: the window, and one pane with nothing named in it.
    window: { role: "window", name: windowName, bounds: { x: 0, y: 0, width: s.width, height: s.height },
      children: [{ role: "pane", ref_id: "@sight:e1", name: "", bounds: { x: 0, y: 0, width: s.width, height: s.height } }] },
    image: { data: fs.readFileSync(new URL(`./screens/${name}.png`, import.meta.url)).toString("base64"), width: s.width, height: s.height },
    ask: s.ask,
    check: spotIn(s.target),
  };
});
