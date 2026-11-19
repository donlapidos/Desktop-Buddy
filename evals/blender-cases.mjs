// Building in Blender (src/blender.js), on a stand-in Blender that keeps the scene (evals.js blenderScene): a cabin
// from scratch, opening Blender first, and changing what's there. Each check reads what was built, from the
// operations Buddy sent. The second clip's rehearsal (docs/DEMO.md).
// Run: npm run eval -- --provider <id> --model <id> --set blender

/** @typedef {import("../src/evals.js").Call} Call */

const BLENDER = { role: "window", name: "Blender [Unsaved]", children: [{ role: "pane", ref_id: "@blender:e1", name: "" }] };
const ops = (/** @type {Call[]} */ calls, /** @type {string} */ op) => calls.filter((c) => c.kind === "blender" && c.name === op);
const added = (/** @type {Call[]} */ calls) => ops(calls, "add").map((c) => c.input);

/**
 * What was built: added objects, and existing ones changed into parts (a model may resize and rename the default cube
 * into the walls), as boxes where their size is known.
 * @returns {{ name: string, location: number[], size?: number[], rotation?: number[], color?: string, glow?: number }[]}
 */
function built(/** @type {Call[]} */ calls) {
  const parts = new Map();
  for (const c of calls.filter((c) => c.kind === "blender" && (c.name === "add" || c.name === "change"))) {
    const before = parts.get(c.input.name) ?? (c.name === "change" ? { location: [0, 0, 0], size: [2, 2, 2] } : {});
    parts.delete(c.input.name);
    parts.set(c.input.rename ?? c.input.name, { ...before, ...c.input, name: c.input.rename ?? c.input.name, location: c.input.location ?? before.location ?? [0, 0, 0] });
  }
  return [...parts.values()];
}

// Supported: on the ground, or touching another part (a roof on walls, a window in a wall, layers of a tree). Boxes
// are compared with 15 cm to spare; tilted parts (roof panels) count as supports but aren't judged themselves.
const box = (/** @type {any} */ o) => o.location.map((c, i) => [c - o.size[i] / 2, c + o.size[i] / 2]);
const touching = (/** @type {any} */ a, /** @type {any} */ b) => box(a).every(([lo, hi], i) => lo <= box(b)[i][1] + 0.15 && hi >= box(b)[i][0] - 0.15);

/**
 * Passes when Buddy built a cabin: at least six parts including walls, a roof and a door, given colours, standing on the
 * ground or on each other (nothing sunk or floating free), lit, the camera placed, without an endless stream of
 * operations, and nothing of the user's deleted (the default cube may go).
 */
export const cabinBuilt = (/** @type {Call[]} */ calls) => {
  if (calls.some((c) => c.kind === "act")) return "it clicked in Blender instead of building";
  const parts = built(calls);
  if (parts.length < 6) return `only ${parts.length} parts`;
  const names = parts.map((o) => String(o.name).toLowerCase()).join(" | ");
  for (const [what, pattern] of [["walls", /wall|cabin|house|log/], ["a roof", /roof/], ["a door", /door/]]) if (!pattern.test(names)) return `no ${what} among ${names}`;
  if (parts.filter((o) => o.color).length < 3) return "hardly anything was given a colour";
  const sized = parts.filter((o) => o.size);
  const judged = sized.filter((o) => !o.rotation || o.rotation.every((d) => Math.abs(d) < 1));
  const off = judged.filter((o) => {
    const bottom = o.location[2] - o.size[2] / 2;
    if (bottom < -0.5) return true;
    return bottom > 0.3 && !sized.some((other) => other !== o && touching(o, other));
  });
  if (off.length > 2) return `several parts float or sink: ${off.map((o) => `${o.name} (bottom at ${(o.location[2] - o.size[2] / 2).toFixed(2)} m)`).join(", ")}`;
  if (!ops(calls, "light").length && !parts.some((o) => (o.glow ?? 0) > 0)) return "no light added and nothing glows";
  if (!ops(calls, "camera").length) return "the camera wasn't placed";
  if (calls.filter((c) => c.kind === "blender").length > 80) return "far too many separate operations";
  const deleted = ops(calls, "delete").flatMap((c) => c.input.names).filter((n) => n !== "Cube");
  return deleted.length ? `deleted ${deleted.join(", ")} without being asked` : null;
};

/** Passes when Buddy opened Blender before building, and built a snowman: three or more spheres, stacked. */
export const snowmanBuilt = (/** @type {Call[]} */ calls) => {
  const opened = calls.findIndex((c) => c.kind === "blender" && c.name === "open");
  if (opened < 0) return "it didn't open Blender";
  const first = calls.findIndex((c) => c.kind === "blender" && c.name === "add");
  if (first < 0) return "it opened Blender but built nothing";
  if (first < opened) return "it built before Blender was open";
  const balls = added(calls).filter((o) => /sphere/.test(o.shape)).sort((a, b) => (a.location?.[2] ?? 0) - (b.location?.[2] ?? 0));
  if (balls.length < 3) return `only ${balls.length} snowballs`;
  const [low, , high] = [balls[0], balls[1], balls.at(-1)];
  return (high.location?.[2] ?? 0) > (low.location?.[2] ?? 0) + 0.3 ? null : "the snowballs aren't stacked";
};

/** Passes when Buddy changed the existing table (red, twice as long) instead of adding a new one, and deleted nothing. */
export const tableChanged = (/** @type {Call[]} */ calls) => {
  if (ops(calls, "delete").length) return "it deleted something";
  if (added(calls).some((o) => /table/i.test(o.name))) return "it added a new table instead of changing the one there";
  const change = ops(calls, "change").map((c) => c.input).filter((o) => o.name === "Table");
  if (!change.length) return "the table wasn't changed";
  const color = change.map((o) => o.color).filter(Boolean).at(-1);
  const rgb = color ? [1, 3, 5].map((i) => parseInt(color.replace("#", "").slice(i - 1, i + 1), 16)) : null;
  if (!rgb || !(rgb[0] > 150 && rgb[1] < 110 && rgb[2] < 110)) return `the colour isn't red: ${color}`;
  const size = change.map((o) => o.size).filter(Boolean).at(-1);
  return size && Math.abs(size[0] - 3.2) < 0.25 ? null : `the length isn't doubled to 3.2 m: ${JSON.stringify(size)}`;
};

/** @type {import("../src/evals.js").EvalCase[]} */
export const BLENDER_CASES = [
  { id: "blender-cabin", title: "Blender: build a cabin in the woods", app: "blender.exe", window: BLENDER, blender: {},
    ask: "Build a cozy little cabin in the woods, with a warm light glowing in the window.", check: cabinBuilt },
  { id: "blender-open", title: "Blender: open it, then build a snowman", app: "msedge.exe", window: { role: "window", name: "New tab - Microsoft Edge", children: [] },
    blender: { state: "installed" }, ask: "Open Blender and build me a snowman.", check: snowmanBuilt },
  { id: "blender-change", title: "Blender: change what's there", app: "blender.exe", window: BLENDER,
    blender: { objects: { Table: { kind: "mesh", location: [0, 0, 0.4], size: [1.6, 0.8, 0.8] }, Chair: { kind: "mesh", location: [0, -0.8, 0.25], size: [0.5, 0.5, 0.5] }, Light: { kind: "light" }, Camera: { kind: "camera" } } },
    ask: "Make the table red and twice as long.", check: tableChanged },
];
