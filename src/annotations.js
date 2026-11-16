// Model input is a small vocabulary of ref-anchored shapes, never executable markup or arbitrary coordinates.
export const ANNOTATION_KINDS = Object.freeze(["highlight", "circle", "arrow", "label", "drag"]);
export const validBox = (b) => !!b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
export const sameBox = (a, b) => validBox(a) && validBox(b) && ["x", "y", "width", "height"].every((k) => Math.abs(a[k] - b[k]) <= 3);
export const centerOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
export const insideBox = (p, b) => validBox(b) && p.x >= b.x && p.y >= b.y && p.x <= b.x + b.width && p.y <= b.y + b.height;

/** @typedef {{ kind: string, bounds: import("./geometry.js").PhysicalRect, to?: import("./geometry.js").PhysicalRect, label: string, number?: number }} Annotation */

/** @param {any} input @returns {{ items: any[], caption: string }} */
export function annotationRequest(input) {
  if (!Array.isArray(input?.items) || !input.items.length || input.items.length > 6) throw new Error("Use between one and six annotations.");
  if (input.caption != null && (typeof input.caption !== "string" || input.caption.length > 240)) throw new Error("Keep the spoken caption under 240 characters.");
  const items = input.items.map((item) => {
    if (!item || !ANNOTATION_KINDS.includes(item.kind) || typeof item.ref !== "string" || !item.ref.trim()) throw new Error("Each annotation needs a supported kind and a real control ref.");
    if (item.to_ref != null && (typeof item.to_ref !== "string" || !item.to_ref.trim())) throw new Error("The destination must be a real control ref.");
    if (item.kind === "drag" && !item.to_ref) throw new Error("A drag path needs both ref and to_ref.");
    if (item.label != null && (typeof item.label !== "string" || item.label.length > 120)) throw new Error("Keep labels under 120 characters.");
    if (item.kind === "label" && !item.label?.trim()) throw new Error("A label needs some text.");
    if (item.number != null && (!Number.isInteger(item.number) || item.number < 1 || item.number > 99)) throw new Error("A step number must be from 1 to 99.");
    return { kind: item.kind, ref: item.ref, ...(item.to_ref ? { to_ref: item.to_ref } : {}), label: item.label?.trim() ?? "", ...(item.number ? { number: item.number } : {}) };
  });
  return { items, caption: input.caption?.trim() ?? "" };
}

const clamp = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));
const edge = (box, toward) => {
  const c = centerOf(box), dx = toward.x - c.x, dy = toward.y - c.y;
  const t = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
  return Number.isFinite(t) ? { x: c.x + dx * t, y: c.y + dy * t } : c;
};

// Coordinates here are already local DIPs. Off-display parts of connectors are clipped by the overlay's SVG.
export function annotationLayout(item, width, height) {
  if (!validBox(item.bounds) || !ANNOTATION_KINDS.includes(item.kind) || !(width > 0 && height > 0)) return null;
  if (item.to && !validBox(item.to)) return null;
  const b = item.bounds, c = centerOf(b);
  const labelWidth = Math.min(Math.max(110, String(item.label ?? "").length * 7 + 28), 260, Math.max(40, width - 16));
  const labelHeight = 18 * Math.max(1, Math.ceil(String(item.label ?? "").length * 7 / Math.max(1, labelWidth - 24))) + 16;
  let labelX = clamp(b.x, 8, width - labelWidth - 8);
  let labelY = b.y + b.height + 12;
  if (labelY + labelHeight > height - 8) labelY = b.y - labelHeight - 12;
  if (labelY < 8 && b.x + b.width + labelWidth + 20 < width) { labelX = b.x + b.width + 12; labelY = b.y; }
  const result = { box: { x: b.x - 5, y: b.y - 5, width: b.width + 10, height: b.height + 10 },
    label: { x: labelX, y: clamp(labelY, 8, height - labelHeight - 8), width: labelWidth, height: labelHeight }, path: "", start: null };
  if (item.kind === "arrow" || item.kind === "drag") {
    const other = item.to ? centerOf(item.to) : { x: clamp(c.x - 90, 16, width - 16), y: clamp(b.y - 65, 16, height - 16) };
    const start = item.to ? (item.kind === "drag" ? c : edge(b, other)) : other;
    const end = item.to ? edge(item.to, c) : edge(b, other);
    const bend = Math.min(65, Math.hypot(end.x - start.x, end.y - start.y) * 0.2);
    result.path = `M ${start.x} ${start.y} C ${start.x} ${start.y - bend} ${end.x} ${end.y - bend} ${end.x} ${end.y}`;
    result.start = start;
  }
  return result;
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export function annotationLayouts(items, width, height) {
  const placed = [];
  const controls = items.flatMap((item) => [item.bounds, item.to].filter(validBox));
  return items.map((item) => {
    const layout = annotationLayout(item, width, height);
    if (!layout || !item.label || item.showLabel === false) return layout;
    const base = layout.label, b = item.bounds;
    const candidates = [{ x: base.x, y: base.y }, { x: b.x, y: b.y - base.height - 12 },
      { x: b.x + b.width + 12, y: b.y }, { x: b.x - base.width - 12, y: b.y }];
    for (let row = 0; row < 6; row++) candidates.push({ x: base.x, y: base.y + row * (base.height + 8) },
      { x: 8, y: 8 + row * (base.height + 8) }, { x: width - base.width - 8, y: 8 + row * (base.height + 8) });
    const ranked = candidates.map((p) => {
      const rect = { ...base, x: clamp(p.x, 8, width - base.width - 8), y: clamp(p.y, 8, height - base.height - 8) };
      return { rect, score: placed.reduce((sum, other) => sum + overlap(rect, other) * 1000, 0)
        + controls.reduce((sum, other) => sum + overlap(rect, other) * 10, 0) + Math.hypot(rect.x - base.x, rect.y - base.y) };
    }).sort((a, b) => a.score - b.score);
    layout.label = ranked[0].rect;
    placed.push({ ...layout.label, x: layout.label.x - 4, y: layout.label.y - 4, width: layout.label.width + 8, height: layout.label.height + 8 });
    return layout;
  });
}

// One visible batch belongs to one conversation. Slow validation, expiry and old completions cannot erase or
// resurrect a newer owner's batch. No polling or animation runs while the layer is empty.
export function createAnnotationLayer({ draw, erase, intervalMs = 1000, lifetimeMs = 60_000 }) {
  let active = null, sequence = 0;
  function clear(owner) {
    if (!active || (owner != null && active.owner !== owner)) return;
    clearTimeout(active.timer);
    clearTimeout(active.expiry);
    active.signal?.removeEventListener("abort", active.abort);
    active.cancel?.();
    active = null;
    sequence++;
    erase();
  }
  /** @param {string} owner @param {any[]} items @param {{ validate?: () => Promise<boolean> | boolean, signal?: AbortSignal }} options */
  async function show(owner, items, { validate, signal } = {}) {
    clear();
    const batch = { owner, items, validate, signal, n: ++sequence, timer: null, expiry: null, cancel: null, abort: () => clear(owner) };
    const cancelled = new Promise((resolve) => { batch.cancel = () => resolve(false); });
    active = batch;
    if (signal?.aborted) { clear(owner); return false; }
    signal?.addEventListener("abort", batch.abort, { once: true });
    const current = () => active === batch && !signal?.aborted;
    const valid = async () => {
      let timer;
      try {
        return await Promise.race([Promise.resolve().then(() => validate ? validate() : true).catch(() => false), cancelled,
          new Promise((resolve) => { timer = setTimeout(() => resolve(false), 4000); })]);
      } finally { clearTimeout(timer); }
    };
    if (!(await valid()) || !current()) { if (active === batch) clear(owner); return false; }
    draw(items, owner);
    const check = async () => {
      if (!current()) return;
      if (!(await valid())) { if (active === batch) clear(owner); return; }
      if (current()) { batch.timer = setTimeout(check, intervalMs); batch.timer.unref?.(); }
    };
    batch.timer = setTimeout(check, intervalMs);
    batch.expiry = setTimeout(() => { if (active === batch) clear(owner); }, lifetimeMs);
    batch.timer.unref?.(); batch.expiry.unref?.();
    return true;
  }
  function release(owner, ms = 0) {
    const batch = active;
    if (!batch || batch.owner !== owner) return;
    if (!ms) return clear(owner);
    clearTimeout(batch.expiry);
    batch.expiry = setTimeout(() => { if (active === batch) clear(owner); }, ms);
    batch.expiry.unref?.();
  }
  return { show, clear, release, owner: () => active?.owner ?? null };
}
