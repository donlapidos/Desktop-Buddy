// Two kinds of screen coordinates meet in Buddy, and mixing them up puts the pointer in the wrong place on any
// display that isn't at 100% scale (this laptop runs at 125%):
//   physical  pixels as agent-desktop reports and expects them (the CLI is per-monitor DPI aware)
//   DIP       Electron's device-independent pixels: the cursor, displays, Buddy's own windows
// They are separate types, so `npm run check` refuses one where the other belongs. The brand exists only for the
// checker; at runtime these are plain { x, y } objects. Values enter a space through the as* functions below, and
// move between spaces only through the conversions in main.js (toPhysicalPoint, toPhysicalRect, toDipRect).

/** @typedef {{ x: number, y: number }} XY */
/** @typedef {{ x: number, y: number, width: number, height: number }} XYWH */
/** @typedef {XY & { readonly __space: "dip" }} DipPoint */
/** @typedef {XYWH & { readonly __space: "dip" }} DipRect */
/** @typedef {XY & { readonly __space: "physical" }} PhysicalPoint */
/** @typedef {XYWH & { readonly __space: "physical" }} PhysicalRect */

/** Electron gives DIP: the cursor, display bounds, window bounds. @param {XY} p @returns {DipPoint} */
export const asDipPoint = (p) => /** @type {DipPoint} */ (p);
/** @param {XYWH} r @returns {DipRect} */
export const asDipRect = (r) => /** @type {DipRect} */ (r);
/** agent-desktop gives physical: element and window bounds. @param {XY} p @returns {PhysicalPoint} */
export const asPhysicalPoint = (p) => /** @type {PhysicalPoint} */ (p);
/** @param {XYWH} r @returns {PhysicalRect} */
export const asPhysicalRect = (r) => /** @type {PhysicalRect} */ (r);

// A spot on a window's screenshot (fractions of its width and height, as a model that sees the picture gives them),
// for apps that expose no control to point at. agent-desktop captures a window without its invisible resize borders
// (left, right and bottom on Windows 10 and 11), so the picture is narrower and shorter than the window's bounds: the
// spot is measured from the picture's own edges. The result is a small physical box around it.
export const SPOT_BOX = 44;
/**
 * @param {{ x: number, y: number }} spot fractions, 0 to 1
 * @param {{ window: PhysicalRect, width: number, height: number }} shot the window's bounds when it was captured, and the picture's size in physical pixels
 * @returns {PhysicalRect | null} null when the spot or the shot doesn't make sense
 */
export function spotRect(spot, shot) {
  const { x, y } = spot ?? {};
  const w = shot?.window;
  if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return null;
  if (!w || ![w.x, w.y, w.width, w.height, shot.width, shot.height].every(Number.isFinite) || shot.width <= 0 || shot.height <= 0) return null;
  const width = Math.min(shot.width, w.width);
  const height = Math.min(shot.height, w.height);
  const left = w.x + (w.width - width) / 2;
  const half = SPOT_BOX / 2;
  const cx = Math.min(left + width - half, Math.max(left + half, left + x * width));
  const cy = Math.min(w.y + height - half, Math.max(w.y + half, w.y + y * height));
  return asPhysicalRect({ x: Math.round(cx - half), y: Math.round(cy - half), width: SPOT_BOX, height: SPOT_BOX });
}
