import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { Brain } from "../src/brain.js";
import { BLENDER_TOOLS, blenderRequest, checkInput, createBlender, program, runBlenderTool } from "../src/blender.js";

// Building in Blender (blender.js). Nothing here reaches a real Blender: a stand-in client, or a stand-in of the
// add-on's socket on a free port.

/** A stand-in Blender client: records what would be sent. */
function fakeBlender(state = "connected") {
  const sent = [];
  return {
    sent,
    pause: 0,
    state: async () => state,
    forget() {},
    open: async () => ((state = "connected"), true),
    run: async (op, args) => (sent.push({ op, args }), op === "add" ? { added: args.name } : op === "change" ? { changed: args.name } : { ok: true }),
    picturePath: () => "unused.png",
  };
}
const asking = () => {
  const asked = [];
  return { asked, ask: async (summary, note, scope) => (asked.push({ summary, scope }), true) };
};

test("what the model gives is only data: a name full of Python stays a name, read back with json.loads", () => {
  const evil = 'Wall"); import os; os.system("calc") #';
  const code = program("add", { shape: "cube", name: evil });
  const last = code.trimEnd().split("\n").at(-1);
  const literal = last.match(/^result = add\(json\.loads\((".*")\)\)$/)?.[1];
  assert.ok(literal, last);
  assert.deepEqual(JSON.parse(JSON.parse(literal)), { shape: "cube", name: evil }, "the data comes back exactly");
  assert.equal(code.split(evil).length, 1, "the raw text appears nowhere in the code; only escaped, inside the JSON");
  assert.equal(program("add", { shape: "cube", name: "Other" }).replace(/json\.loads\(".*"\)/, ""), code.replace(/json\.loads\(".*"\)/, ""), "the rest of the code is fixed");
});

test("inputs are checked: blanks a model fills in count as left out, a flat plane is fine, nonsense is refused", () => {
  const ok = checkInput("blender_add", { objects: [{ shape: "plane", name: "Ground", size: [20, 20, 0], color: "", material: "", rotation: null }, { shape: "cube", name: "Box", size: [0, 0, 0], color: "#a0522d" }] });
  assert.equal(typeof ok, "object", String(ok));
  assert.deepEqual(ok.objects[0], { shape: "plane", name: "Ground", size: [20, 20, 0] });
  assert.equal(ok.objects[1].size, undefined, "a size of 0, 0, 0 means not given");
  for (const [name, input, why] of [
    ["blender_add", { objects: [{ shape: "dragon", name: "X" }] }, /shape/],
    ["blender_add", { objects: [{ shape: "cube", name: "X", color: "red" }] }, /#rrggbb/],
    ["blender_add", { objects: [{ shape: "cube", name: "X", location: [1, 2] }] }, /location/],
    ["blender_add", { objects: [{ shape: "cube", name: "Line\nbreak" }] }, /name/],
    ["blender_add", { objects: Array.from({ length: 41 }, (_, i) => ({ shape: "cube", name: `C${i}` })) }, /1 to 40/],
    ["blender_camera", { location: [1, 2, 3] }, /aim/],
    ["blender_light", { name: "L", kind: "laser" }, /kind/],
    ["blender_modifier", { name: "Fence", kind: "array", count: 1000 }, /count/],
    ["blender_world", { color: "#zzzzzz" }, /#rrggbb/],
  ]) assert.match(String(checkInput(name, input)), why, `${name} ${JSON.stringify(input).slice(0, 60)}`);
});

test("building asks once on the card for the task; looking never asks; deleting asks every time", async () => {
  const blender = fakeBlender();
  const { asked, ask } = asking();
  const ctx = { blender, ask };
  assert.match(String(await runBlenderTool("blender_scene", {}, ctx)), /ok/);
  assert.equal(asked.length, 0, "looking at the scene doesn't ask");
  assert.match(String(await runBlenderTool("blender_add", { objects: [{ shape: "cube", name: "Walls" }, { shape: "cone", name: "Roof" }] }, ctx)), /Added: Walls, Roof/);
  assert.deepEqual(asked.at(-1), { summary: "Build in Blender: add Walls, Roof", scope: "blender" }, "one card for the whole batch, allowable for the task");
  assert.deepEqual(blender.sent.filter((s) => s.op === "add").map((s) => s.args.name), ["Walls", "Roof"], "one object at a time, so the user watches it grow");
  await runBlenderTool("blender_camera", { location: [8, -8, 5], aim: [0, 0, 1] }, ctx);
  assert.equal(asked.at(-1).scope, "blender");
  await runBlenderTool("blender_delete", { names: ["Roof"] }, ctx);
  assert.deepEqual(asked.at(-1), { summary: "Delete in Blender: Roof", scope: undefined }, "deleting is never covered by Allow for this task");
});

test("a no on the card sends nothing; a bad input or a Blender that isn't connected sends nothing either", async () => {
  const blender = fakeBlender();
  const no = { blender, ask: async () => false };
  assert.equal(await runBlenderTool("blender_add", { objects: [{ shape: "cube", name: "Walls" }] }, no), "The user declined.");
  assert.equal(await runBlenderTool("blender_delete", { names: ["Walls"] }, no), "The user declined.");
  assert.match(String(await runBlenderTool("blender_add", { objects: [{ shape: "dragon", name: "X" }] }, { blender, ask: async () => true })), /^Not sent/);
  const away = fakeBlender("installed");
  assert.match(String(await runBlenderTool("blender_add", { objects: [{ shape: "cube", name: "Walls" }] }, { blender: away, ask: async () => true })), /isn't connected.*blender_open/);
  assert.deepEqual([...blender.sent, ...away.sent], [], "nothing reached Blender");
});

test("opening Blender asks first, and then its building tools are offered", async () => {
  const blender = fakeBlender("installed");
  const declined = await runBlenderTool("blender_open", {}, { blender, ask: async () => false });
  assert.equal(declined, "The user declined.");
  assert.equal(await blender.state(), "installed");
  const { asked, ask } = asking();
  assert.match(String(await runBlenderTool("blender_open", {}, { blender, ask })), /open and connected/);
  assert.match(asked[0].summary, /Open Blender/);
});

test("Brain offers the building tools only while Blender is connected, opening it while it's installed, and nothing without the advanced features", async () => {
  const names = async (state, advanced = true) => {
    const b = new Brain({ apiKey: "sk-test", status() {}, point: async () => {}, advanced: () => advanced, blender: fakeBlender(state) });
    await b.checkBlender();
    return { tools: b.tools().map((t) => t.name).filter((n) => n.startsWith("blender_")), system: b.system() };
  };
  const connected = await names("connected");
  assert.deepEqual(connected.tools, BLENDER_TOOLS.map((t) => t.name));
  assert.match(connected.system, /Blender is open on this PC and connected/);
  assert.deepEqual((await names("installed")).tools, ["blender_open"]);
  assert.deepEqual((await names("absent")).tools, []);
  assert.deepEqual((await names("connected", false)).tools, [], "basic Buddy doesn't build");
});

test("the add-on's wire format: JSON then a zero byte each way; Blender's error comes back in its own words", async (t) => {
  const got = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf(0);
      if (end < 0) return;
      const request = JSON.parse(buf.subarray(0, end).toString());
      got.push(request);
      const reply = request.code.includes("result = add(")
        ? { status: "error", message: "Traceback (most recent call last):\n  File ...\nValueError: There's no object called 'Roof' in the scene." }
        : { status: "ok", result: { ok: true } };
      socket.end(`${JSON.stringify(reply)}\0`);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const port = /** @type {any} */ (server.address()).port;
  assert.deepEqual(await blenderRequest("result = {'ok': True}", { port }), { status: "ok", result: { ok: true } });
  assert.equal(got[0].type, "execute");
  assert.equal(got[0].strict_json, true);
  const blender = createBlender({ port, find: () => null });
  assert.equal(await blender.state(), "connected");
  await assert.rejects(blender.run("add", { shape: "cube", name: "X" }), /There's no object called 'Roof'/);
  const nobody = createBlender({ port: 1, find: () => null });
  assert.equal(await nobody.state(), "absent", "nothing listening and nothing installed");
});

test("the building checks pass a sound build and catch a missing roof, a floating part, a deletion, and a table added instead of changed", async () => {
  const { cabinBuilt, snowmanBuilt, tableChanged } = await import("../evals/blender-cases.mjs");
  const op = (name, input) => ({ kind: /** @type {const} */ ("blender"), name, input });
  const cabin = [
    op("add", { shape: "plane", name: "Ground", location: [0, 0, 0], size: [20, 20, 0], color: "#4a7a3a" }),
    op("add", { shape: "cube", name: "Foundation", location: [0, 0, 0.15], size: [4.4, 3.4, 0.3], color: "#777777" }),
    op("add", { shape: "cube", name: "Walls", location: [0, 0, 1.55], size: [4, 3, 2.5], color: "#8a5a32" }),
    op("add", { shape: "cube", name: "Roof left", location: [0, -0.8, 3.1], rotation: [35, 0, 0], size: [4.6, 2.2, 0.15], color: "#5a2e22" }),
    op("add", { shape: "cube", name: "Door", location: [0, -1.52, 1.2], size: [0.9, 0.06, 1.8] }),
    op("add", { shape: "cube", name: "Window", location: [1.3, -1.52, 1.8], size: [0.8, 0.06, 0.7], glow: 4 }),
    op("camera", { location: [9, -11, 5], aim: [0, 0, 1.5] }),
  ];
  assert.equal(cabinBuilt(cabin), null, "standing on a foundation, a window in a wall: all supported");
  assert.match(cabinBuilt(cabin.filter((c) => !/Roof/.test(c.input.name ?? ""))) ?? "", /roof|parts/);
  const floating = [...cabin, ...[1, 2, 3].map((n) => op("add", { shape: "cube", name: `Crate ${n}`, location: [8 + n * 2, 8, 5], size: [1, 1, 1] }))];
  assert.match(cabinBuilt(floating) ?? "", /float/);
  assert.match(cabinBuilt([...cabin, op("delete", { names: ["Their sculpture"] })]) ?? "", /deleted Their sculpture/);
  const reused = [op("change", { name: "Cube", rename: "Cabin walls", location: [0, 0, 1.25], size: [4, 3, 2.5], color: "#8a5a32" }), ...cabin.filter((c) => c.input.name !== "Walls")];
  assert.equal(cabinBuilt(reused), null, "the default cube made into the walls counts");
  const balls = [0.5, 1.4, 2.1].map((z, n) => op("add", { shape: "sphere", name: `Ball ${n}`, location: [0, 0, z] }));
  assert.equal(snowmanBuilt([{ kind: "blender", name: "open" }, ...balls]), null);
  assert.match(snowmanBuilt([...balls, { kind: "blender", name: "open" }]) ?? "", /before Blender was open/);
  assert.equal(tableChanged([op("change", { name: "Table", color: "#c0392b", size: [3.2, 0.8, 0.8] })]), null);
  assert.match(tableChanged([op("add", { shape: "cube", name: "Red table", color: "#c0392b", size: [3.2, 0.8, 0.8] })]) ?? "", /new table/);
});
