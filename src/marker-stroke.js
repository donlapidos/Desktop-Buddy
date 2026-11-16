export const MAX_STROKE_POINTS = 4000;

// Keep the latest tip when a long stroke fills the budget. Truncating the tail
// freezes the pen at its old endpoint; thinning older samples leaves room to draw.
export function appendStrokePoint(points, point, force = false) {
  if (![point.x, point.y].every(Number.isFinite)) return;
  const last = points.at(-1);
  const distance = last ? Math.hypot(point.x - last.x, point.y - last.y) : Infinity;
  if (distance === 0 || (!force && distance < 1.5)) return;
  points.push({ x: point.x, y: point.y });
  if (points.length > MAX_STROKE_POINTS) {
    const reduced = points.filter((_p, i) => i % 2 === 0 || i === points.length - 1);
    points.splice(0, points.length, ...reduced);
  }
}

export function pointerSamples(event) {
  const samples = event.getCoalescedEvents?.();
  return samples?.length ? samples : [event];
}
