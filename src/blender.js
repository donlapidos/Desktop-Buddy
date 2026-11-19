// Building in Blender, live: the user asks, and the scene grows in their Blender while they watch.
//
// Buddy talks to Blender Lab's official MCP add-on (blender.org/lab/mcp-server), which listens on this PC only
// (localhost:9876) and runs the Python it's sent. That add-on runs any code without guards, so the model never writes
// Python here. It picks from fixed building tools (BLENDER_TOOLS) and gives only data: names, sizes, positions,
// colours. Buddy checks that data (checkInput), and sends its own fixed Python (OPS) with the data as a JSON string the
// Python reads with json.loads, so nothing the model says can become code.
//
// Approvals: looking (the scene list, a picture of the 3D view) never asks; building asks once on Buddy's card and
// "Allow for this task" covers the rest of the answer, since it only changes the open scene and each change is one
// Ctrl+Z step in Blender (undo_push); deleting asks every time. Opening Blender asks too.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const BLENDER_PORT = 9876;
const MAX_OBJECTS = 40;
const vec3 = (description) => ({ type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description });
const COLOR = { type: "string", description: "A colour as #rrggbb, like #c8a165 for warm wood." };
const SHAPES = ["cube", "sphere", "ico_sphere", "cylinder", "cone", "torus", "plane", "monkey"];
const LOOK = { type: "object", properties: {
  color: COLOR,
  material: { type: "string", description: "A material name to share between objects (\"Wood\", \"Glass\"): objects given the same name share one material." },
  metallic: { type: "number", minimum: 0, maximum: 1 },
  roughness: { type: "number", minimum: 0, maximum: 1, description: "0 mirror-like, 1 matte." },
  glow: { type: "number", minimum: 0, maximum: 50, description: "How brightly it glows in its own colour (a lamp, a window at night). 0 for none." },
} };

/** The tools the model is offered while Blender is connected. @type {{ name: string, description: string, input_schema: any }[]} */
export const BLENDER_TOOLS = [
  {
    name: "blender_scene",
    description: "List what's in the user's open Blender scene: each object's name, kind, position, rotation, size in metres, materials and modifiers, and the camera and lights. Read-only; doesn't ask.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "blender_view",
    description: "See the user's Blender 3D view as a picture, to check your work. Optionally set how it's shaded first (solid; material, to see colours; rendered, with lights) and frame the whole scene or look through the camera. Doesn't ask.",
    input_schema: { type: "object", properties: {
      shading: { type: "string", enum: ["solid", "material", "rendered"] },
      frame: { type: "string", enum: ["all", "camera"], description: "all: zoom to fit everything; camera: look through the scene camera." },
    } },
  },
  {
    name: "blender_add",
    description: `Add objects to the scene, built one after another so the user watches it grow (up to ${MAX_OBJECTS} per call). Z is up, sizes are in metres, and a shape is centred on its location: a box 3 m tall standing on the ground has location z = 1.5. Give each a size (its width, depth and height in metres) and a look. The user approves building once for the task.`,
    input_schema: { type: "object", properties: { objects: { type: "array", maxItems: MAX_OBJECTS, items: { type: "object", properties: {
      shape: { type: "string", enum: SHAPES },
      name: { type: "string", description: "A clear name the user will see, like \"Roof left\"." },
      location: vec3("Centre position x, y, z in metres."),
      rotation: vec3("Rotation about x, y, z in degrees."),
      size: vec3("Width (x), depth (y) and height (z) in metres."),
      smooth: { type: "boolean", description: "Smooth shading, for round things." },
      bevel: { type: "number", minimum: 0, maximum: 1, description: "Round the edges by this many metres." },
      ...LOOK.properties,
    }, required: ["shape", "name"] } } }, required: ["objects"] },
  },
  {
    name: "blender_change",
    description: "Change objects already in the scene: move, rotate, resize, rename, or change their look. Only what's given changes. The user approves building once for the task.",
    input_schema: { type: "object", properties: { objects: { type: "array", maxItems: MAX_OBJECTS, items: { type: "object", properties: {
      name: { type: "string" },
      rename: { type: "string" },
      location: vec3("x, y, z in metres."),
      rotation: vec3("Degrees about x, y, z."),
      size: vec3("Width, depth and height in metres."),
      ...LOOK.properties,
    }, required: ["name"] } } }, required: ["objects"] },
  },
  {
    name: "blender_modifier",
    description: "Add a modifier to an object: bevel (rounded edges), subdivision (smoother), array (a row of copies, like fence posts or steps), mirror, or solidify (gives a flat shape thickness). The user approves building once for the task.",
    input_schema: { type: "object", properties: {
      name: { type: "string", description: "The object's name." },
      kind: { type: "string", enum: ["bevel", "subdivision", "array", "mirror", "solidify"] },
      amount: { type: "number", description: "bevel: width in metres; subdivision: levels (1-4); solidify: thickness in metres." },
      count: { type: "integer", minimum: 2, maximum: 100, description: "array: how many in the row." },
      offset: vec3("array: the step from one copy to the next, in metres."),
      axis: { type: "string", enum: ["x", "y", "z"], description: "mirror: across which axis." },
    }, required: ["name", "kind"] },
  },
  {
    name: "blender_light",
    description: "Add a light, or change one by name: point (a bulb), sun (daylight from a direction), spot, or area (a soft panel). The user approves building once for the task.",
    input_schema: { type: "object", properties: {
      name: { type: "string" },
      kind: { type: "string", enum: ["point", "sun", "spot", "area"] },
      location: vec3("x, y, z in metres."),
      aim: vec3("A point the light faces, for sun, spot and area."),
      color: COLOR,
      power: { type: "number", minimum: 0, maximum: 100000, description: "Watts for point, spot and area (a room lamp is about 100-1000); strength for sun (about 1-5)." },
      size: { type: "number", minimum: 0, maximum: 50, description: "How big the light is, in metres: bigger is softer." },
    }, required: ["name", "kind"] },
  },
  {
    name: "blender_camera",
    description: "Place the scene camera (made if there isn't one) and aim it at a point, to frame the build. The user approves building once for the task.",
    input_schema: { type: "object", properties: {
      location: vec3("x, y, z in metres."),
      aim: vec3("The point it looks at."),
      lens: { type: "number", minimum: 10, maximum: 200, description: "Focal length in mm: 24 wide, 50 normal, 85 close." },
    }, required: ["location", "aim"] },
  },
  {
    name: "blender_world",
    description: "Set the sky or background colour and how much light it gives. The user approves building once for the task.",
    input_schema: { type: "object", properties: { color: COLOR, strength: { type: "number", minimum: 0, maximum: 10 } }, required: ["color"] },
  },
  {
    name: "blender_delete",
    description: "Delete objects by name. Asks the user every time.",
    input_schema: { type: "object", properties: { names: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_OBJECTS } }, required: ["names"] },
  },
];

/** Offered instead when Blender is on this PC but not connected. */
export const BLENDER_OPEN = {
  name: "blender_open",
  description: "Open Blender with Buddy's connection on, so you can build in it. Use it when the user wants something built in Blender. Asks the user first.",
  input_schema: { type: "object", properties: {} },
};
export const BLENDER_TOOL_NAMES = new Set([...BLENDER_TOOLS, BLENDER_OPEN].map((t) => t.name));

// ---------- Checking what the model gave ----------

const NAME = /^[^\u0000-\u001f\u007f]{1,60}$/;
const HEX = /^#?[0-9a-f]{6}$/i;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const triple = (v) => Array.isArray(v) && v.length === 3 && v.every(finite) && v.every((n) => Math.abs(n) <= 10000);

/** The look fields an object may carry, checked. @returns {string | null} what's wrong */
function lookProblem(o) {
  if (o.color !== undefined && !(typeof o.color === "string" && HEX.test(o.color))) return `color must be #rrggbb, not ${JSON.stringify(o.color)}`;
  if (o.material !== undefined && !(typeof o.material === "string" && NAME.test(o.material))) return "material must be a short name";
  for (const k of ["metallic", "roughness"]) if (o[k] !== undefined && !(finite(o[k]) && o[k] >= 0 && o[k] <= 1)) return `${k} must be from 0 to 1`;
  if (o.glow !== undefined && !(finite(o.glow) && o.glow >= 0 && o.glow <= 50)) return "glow must be from 0 to 50";
  return null;
}

function placeProblem(o) {
  for (const k of ["location", "rotation"]) if (o[k] !== undefined && !triple(o[k])) return `${k} must be three numbers`;
  // A plane is flat: one size may be 0, never all of them.
  if (o.size !== undefined && !(triple(o.size) && o.size.every((n) => n >= 0 && n <= 1000) && o.size.some((n) => n > 0))) return "size must be three numbers of metres, from 0 to 1000, not all 0";
  return null;
}

/**
 * Fields a model filled with a blank ("", null, [], a size of 0, 0, 0) are left out: GPT fills every optional field,
 * and a blank colour or size means "not given", not a mistake. Objects in a list are cleaned the same way.
 * @param {any} input
 */
export function withoutBlankFields(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    if (k === "size" && Array.isArray(v) && v.every((n) => n === 0)) continue;
    out[k] = k === "objects" && Array.isArray(v) ? v.map(withoutBlankFields) : v;
  }
  return out;
}

/**
 * Checks a tool's input against what Buddy will send. Resolves the clean input, or a string saying what's wrong (the
 * model gets it back and can fix its call).
 * @param {string} name @param {any} input @returns {any | string}
 */
export function checkInput(name, input) {
  const i = withoutBlankFields(input);
  const named = (v, what) => (typeof v === "string" && NAME.test(v) ? null : `${what} must be a name of 1 to 60 characters`);
  const list = (items, each) => {
    if (!Array.isArray(items) || !items.length || items.length > MAX_OBJECTS) return `objects must be a list of 1 to ${MAX_OBJECTS}`;
    for (const [n, o] of items.entries()) {
      const problem = each(o && typeof o === "object" ? o : {});
      if (problem) return `object ${n + 1}: ${problem}`;
    }
    return null;
  };
  switch (name) {
    case "blender_scene":
      return {};
    case "blender_view":
      if (i.shading !== undefined && !["solid", "material", "rendered"].includes(i.shading)) return "shading must be solid, material or rendered";
      if (i.frame !== undefined && !["all", "camera"].includes(i.frame)) return "frame must be all or camera";
      return { shading: i.shading, frame: i.frame };
    case "blender_add": {
      const problem = list(i.objects, (o) => (SHAPES.includes(o.shape) ? null : `shape must be one of ${SHAPES.join(", ")}`) ?? named(o.name, "name") ?? placeProblem(o) ??
        (o.bevel !== undefined && !(finite(o.bevel) && o.bevel >= 0 && o.bevel <= 1) ? "bevel must be from 0 to 1 metre" : null) ?? lookProblem(o));
      return problem ?? { objects: i.objects };
    }
    case "blender_change": {
      const problem = list(i.objects, (o) => named(o.name, "name") ?? (o.rename !== undefined ? named(o.rename, "rename") : null) ?? placeProblem(o) ?? lookProblem(o));
      return problem ?? { objects: i.objects };
    }
    case "blender_modifier": {
      const problem = named(i.name, "name") ?? (["bevel", "subdivision", "array", "mirror", "solidify"].includes(i.kind) ? null : "kind must be bevel, subdivision, array, mirror or solidify") ??
        (i.amount !== undefined && !(finite(i.amount) && i.amount >= 0 && i.amount <= 10) ? "amount must be from 0 to 10" : null) ??
        (i.count !== undefined && !(Number.isInteger(i.count) && i.count >= 2 && i.count <= 100) ? "count must be from 2 to 100" : null) ??
        (i.offset !== undefined && !triple(i.offset) ? "offset must be three numbers" : null) ??
        (i.axis !== undefined && !["x", "y", "z"].includes(i.axis) ? "axis must be x, y or z" : null);
      return problem ?? i;
    }
    case "blender_light": {
      const problem = named(i.name, "name") ?? (["point", "sun", "spot", "area"].includes(i.kind) ? null : "kind must be point, sun, spot or area") ??
        placeProblem(i) ?? (i.aim !== undefined && !triple(i.aim) ? "aim must be three numbers" : null) ?? lookProblem({ color: i.color }) ??
        (i.power !== undefined && !(finite(i.power) && i.power >= 0 && i.power <= 100000) ? "power must be from 0 to 100000" : null) ??
        (i.size !== undefined && !(finite(i.size) && i.size >= 0 && i.size <= 50) ? "size must be from 0 to 50 metres" : null);
      return problem ?? i;
    }
    case "blender_camera":
      if (!triple(i.location) || !triple(i.aim)) return "location and aim must be three numbers each";
      if (i.lens !== undefined && !(finite(i.lens) && i.lens >= 10 && i.lens <= 200)) return "lens must be from 10 to 200 mm";
      return { location: i.location, aim: i.aim, lens: i.lens };
    case "blender_world":
      return lookProblem({ color: i.color }) ?? (typeof i.color !== "string" ? "color is needed" : null) ??
        (i.strength !== undefined && !(finite(i.strength) && i.strength >= 0 && i.strength <= 10) ? "strength must be from 0 to 10" : null) ?? { color: i.color, strength: i.strength };
    case "blender_delete":
      if (!Array.isArray(i.names) || !i.names.length || i.names.length > MAX_OBJECTS) return `names must be a list of 1 to ${MAX_OBJECTS}`;
      return i.names.find((n) => named(n, "a name")) !== undefined ? "each name must be 1 to 60 characters" : { names: i.names };
    default:
      return `There's no Blender tool called ${name}.`;
  }
}

// ---------- The Python Buddy sends (fixed; the model's data arrives only through json.loads) ----------

const OPS = String.raw`
import bpy, math
from mathutils import Vector

def _hex(code):
    code = code.lstrip("#")
    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(code[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)

def _object_mode():
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

def _get(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise ValueError("There's no object called %r in the scene." % name)
    return obj

def _place(obj, o):
    if "location" in o:
        obj.location = o["location"]
    if "rotation" in o:
        obj.rotation_euler = [math.radians(d) for d in o["rotation"]]
    if "size" in o and obj.type == "MESH":
        obj.dimensions = o["size"]

def _look(obj, o):
    if not any(k in o for k in ("color", "material", "metallic", "roughness", "glow")) or obj.type != "MESH":
        return
    name = o.get("material") or (obj.name + " material")
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if mat.node_tree else None
    if "color" in o:
        mat.diffuse_color = _hex(o["color"])
        if bsdf:
            bsdf.inputs["Base Color"].default_value = _hex(o["color"])
    if bsdf and "metallic" in o:
        bsdf.inputs["Metallic"].default_value = o["metallic"]
    if bsdf and "roughness" in o:
        bsdf.inputs["Roughness"].default_value = o["roughness"]
    if bsdf and "glow" in o:
        bsdf.inputs["Emission Color"].default_value = bsdf.inputs["Base Color"].default_value
        bsdf.inputs["Emission Strength"].default_value = o["glow"]
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)

ADD = {
    "cube": lambda: bpy.ops.mesh.primitive_cube_add(size=1),
    "sphere": lambda: bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5),
    "ico_sphere": lambda: bpy.ops.mesh.primitive_ico_sphere_add(radius=0.5),
    "cylinder": lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=1),
    "cone": lambda: bpy.ops.mesh.primitive_cone_add(radius1=0.5, depth=1),
    "torus": lambda: bpy.ops.mesh.primitive_torus_add(),
    "plane": lambda: bpy.ops.mesh.primitive_plane_add(size=1),
    "monkey": lambda: bpy.ops.mesh.primitive_monkey_add(size=1),
}

def _redraw():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            area.tag_redraw()

def _done(message, result):
    bpy.ops.ed.undo_push(message="Buddy: " + message)
    _redraw()
    return result

def add(o):
    _object_mode()
    ADD[o["shape"]]()
    obj = bpy.context.active_object
    obj.name = o["name"]
    if "size" in o and o["shape"] == "plane":
        o = dict(o, size=[o["size"][0], o["size"][1], 0])
    _place(obj, o)
    if o.get("smooth"):
        bpy.ops.object.shade_smooth()
    if o.get("bevel"):
        bevel = obj.modifiers.new("Bevel", "BEVEL")
        bevel.width = o["bevel"]
        bevel.segments = 3
    _look(obj, o)
    return _done("add " + obj.name, {"added": obj.name})

def change(o):
    _object_mode()
    obj = _get(o["name"])
    if "rename" in o:
        obj.name = o["rename"]
    _place(obj, o)
    _look(obj, o)
    return _done("change " + obj.name, {"changed": obj.name})

def modifier(o):
    obj = _get(o["name"])
    kind = o["kind"]
    amount = o.get("amount")
    if kind == "bevel":
        m = obj.modifiers.new("Bevel", "BEVEL")
        m.width = amount if amount is not None else 0.05
        m.segments = 3
    elif kind == "subdivision":
        m = obj.modifiers.new("Subdivision", "SUBSURF")
        m.levels = m.render_levels = int(min(4, max(1, amount or 2)))
    elif kind == "array":
        m = obj.modifiers.new("Array", "ARRAY")
        m.count = o.get("count", 3)
        m.use_relative_offset = False
        m.use_constant_offset = True
        m.constant_offset_displace = o.get("offset", [1, 0, 0])
    elif kind == "mirror":
        m = obj.modifiers.new("Mirror", "MIRROR")
        m.use_axis = [o.get("axis", "x") == a for a in "xyz"]
    else:
        m = obj.modifiers.new("Solidify", "SOLIDIFY")
        m.thickness = amount if amount is not None else 0.1
    return _done(kind + " on " + obj.name, {"modifier": m.name, "on": obj.name})

def _aim(obj, point):
    direction = Vector(point) - obj.location
    if direction.length > 0:
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

def light(o):
    _object_mode()
    obj = bpy.data.objects.get(o["name"])
    kind = o["kind"].upper()
    if obj is None or obj.type != "LIGHT":
        data = bpy.data.lights.new(o["name"], kind)
        obj = bpy.data.objects.new(o["name"], data)
        bpy.context.scene.collection.objects.link(obj)
    elif obj.data.type != kind:
        obj.data.type = kind
    if "location" in o:
        obj.location = o["location"]
    if "aim" in o:
        _aim(obj, o["aim"])
    if "color" in o:
        obj.data.color = _hex(o["color"])[:3]
    if "power" in o:
        obj.data.energy = o["power"]
    if "size" in o:
        if kind == "AREA":
            obj.data.size = o["size"]
        elif kind in ("POINT", "SPOT"):
            obj.data.shadow_soft_size = o["size"]
        else:
            obj.data.angle = math.radians(min(o["size"], 30))
    return _done("light " + obj.name, {"light": obj.name})

def camera(o):
    _object_mode()
    scene = bpy.context.scene
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam.location = o["location"]
    _aim(cam, o["aim"])
    if o.get("lens"):
        cam.data.lens = o["lens"]
    return _done("camera", {"camera": cam.name})

def world(o):
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    w = scene.world
    w.color = _hex(o["color"])[:3]
    background = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None) if w.node_tree else None
    if background:
        background.inputs["Color"].default_value = _hex(o["color"])
        if o.get("strength") is not None:
            background.inputs["Strength"].default_value = o["strength"]
    return _done("world", {"world": w.name})

def delete(o):
    _object_mode()
    gone = []
    for name in o["names"]:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
            gone.append(name)
    return _done("delete", {"deleted": gone})

def _r(v, n=2):
    return [round(x, n) for x in v]

def scene(o):
    s = bpy.context.scene
    items = []
    for obj in list(s.objects)[:150]:
        item = {"name": obj.name, "kind": obj.type.lower(), "location": _r(obj.location),
                "rotation": _r([math.degrees(a) for a in obj.rotation_euler], 1)}
        if obj.type == "MESH":
            item["size"] = _r(obj.dimensions)
            item["materials"] = [m.name for m in obj.data.materials if m]
        if obj.modifiers:
            item["modifiers"] = [m.type.lower() for m in obj.modifiers]
        if obj.type == "LIGHT":
            item["light"] = obj.data.type.lower()
            item["power"] = round(obj.data.energy, 2)
        items.append(item)
    return {"objects": items, "count": len(s.objects), "camera": s.camera.name if s.camera else None}

def view(o):
    window = bpy.context.window_manager.windows[0]
    area = next((a for a in window.screen.areas if a.type == "VIEW_3D"), None)
    if area is None:
        raise ValueError("Blender has no 3D view open.")
    space = area.spaces.active
    region = next(r for r in area.regions if r.type == "WINDOW")
    if o.get("shading"):
        space.shading.type = o["shading"].upper()
    with bpy.context.temp_override(window=window, screen=window.screen, area=area, region=region):
        if o.get("frame") == "all":
            bpy.ops.view3d.view_all()
        elif o.get("frame") == "camera" and space.region_3d.view_perspective != "CAMERA" and bpy.context.scene.camera:
            bpy.ops.view3d.view_camera()
    # Drawn off-screen (a viewport render), not read off the window: Blender in the background doesn't redraw its
    # window, so a screenshot would show an old frame. The user's render settings are put back after.
    render = bpy.context.scene.render
    kept = (render.resolution_x, render.resolution_y, render.resolution_percentage)
    try:
        render.resolution_x, render.resolution_y, render.resolution_percentage = region.width, region.height, 100
        with bpy.context.temp_override(window=window, screen=window.screen, area=area, region=region):
            bpy.ops.render.opengl(view_context=True)
        bpy.data.images["Render Result"].save_render(filepath=o["picture"])
    finally:
        render.resolution_x, render.resolution_y, render.resolution_percentage = kept
    _redraw()
    return {"picture": o["picture"], "size": [region.width, region.height]}
`;

/** The Python for one operation: the fixed operations, then the data, read from JSON, never run as code. */
export const program = (/** @type {string} */ op, /** @type {any} */ args) =>
  `import json\n${OPS}\nresult = ${op}(json.loads(${JSON.stringify(JSON.stringify(args))}))\n`;

// ---------- Talking to the add-on ----------

/**
 * Sends Python to the add-on and resolves its reply ({ status: "ok", result } or { status: "error", message }).
 * Rejects when nothing answers.
 * @param {string} code @param {{ port?: number, timeoutMs?: number }} [o]
 */
export function blenderRequest(code, { port = BLENDER_PORT, timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let got = Buffer.alloc(0);
    const timer = setTimeout(() => (socket.destroy(), reject(new Error("Blender didn't answer in time."))), timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify({ type: "execute", code, strict_json: true })}\0`));
    socket.on("data", (chunk) => {
      got = Buffer.concat([got, chunk]);
      const end = got.indexOf(0);
      if (end < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        resolve(JSON.parse(got.subarray(0, end).toString("utf8")));
      } catch {
        reject(new Error("Blender's answer couldn't be read."));
      }
    });
    socket.on("error", (err) => (clearTimeout(timer), reject(err)));
  });
}

/** Whether the add-on answers on this PC. @param {{ port?: number }} [o] */
export async function blenderConnected({ port = BLENDER_PORT } = {}) {
  try {
    const r = await blenderRequest("result = {'ok': True}", { port, timeoutMs: 1500 });
    return r?.status === "ok";
  } catch {
    return false;
  }
}

/** Where Blender is installed (the newest 5.1 or later), or null. Looks in the usual places, portable copies too. */
export function findBlender(env = process.env) {
  const roots = [path.join(env.LOCALAPPDATA ?? "", "Programs", "Blender"), path.join(env.ProgramFiles ?? "C:\\Program Files", "Blender Foundation")];
  const found = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root);
    } catch {}
    for (const name of entries) {
      const exe = path.join(root, name, "blender.exe");
      const version = name.match(/(\d+)\.(\d+)/);
      if (version && fs.existsSync(exe)) found.push({ exe, major: Number(version[1]), minor: Number(version[2]) });
    }
  }
  const ok = found.filter((b) => b.major > 5 || (b.major === 5 && b.minor >= 1)).sort((a, b) => b.major - a.major || b.minor - a.minor);
  return ok[0]?.exe ?? null;
}

// Started this way, Blender allows the add-on's local connection for this session only (--online-mode), and the
// add-on's server is switched on once Blender has settled. No preference is saved.
const START_SERVER = "import bpy\ndef _buddy_start():\n    try:\n        bpy.ops.blmcp.server_start()\n    except Exception as ex:\n        print('Buddy: the MCP add-on did not start:', ex)\n    return None\nbpy.app.timers.register(_buddy_start, first_interval=2.0)\n";

/**
 * A Blender client for Brain: whether Blender can be built in now, opening it, and running one checked operation.
 * Tests and evals pass their own.
 * @param {{ port?: number, find?: () => string | null, launch?: (exe: string, args: string[]) => void, pause?: number }} [o]
 */
export function createBlender({ port = BLENDER_PORT, find = findBlender, launch, pause = 150 } = {}) {
  let known = { at: 0, state: /** @type {"connected" | "installed" | "absent"} */ ("absent") };
  const start = launch ?? ((exe, args) => spawn(exe, args, { detached: true, stdio: "ignore" }).unref());
  return {
    pause,
    /** "connected", "installed" (on this PC, not connected) or "absent". Checked at most every few seconds. */
    async state() {
      if (Date.now() - known.at < 4000) return known.state;
      const state = (await blenderConnected({ port })) ? "connected" : find() ? "installed" : "absent";
      known = { at: Date.now(), state };
      return state;
    },
    forget() {
      known.at = 0;
    },
    /** Opens Blender with the connection on and waits for it. Resolves whether it connected. */
    async open(/** @type {AbortSignal | undefined} */ signal) {
      const exe = find();
      if (!exe) return false;
      start(exe, ["--online-mode", "--python-expr", START_SERVER]);
      for (let i = 0; i < 60 && !signal?.aborted; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await blenderConnected({ port })) return (known = { at: Date.now(), state: "connected" }), true;
      }
      return false;
    },
    /** Runs one operation (an OPS function) with checked data. Resolves its result, or throws with Blender's words. */
    async run(/** @type {string} */ op, /** @type {any} */ args) {
      const reply = await blenderRequest(program(op, args), { port });
      if (reply?.status === "ok") return reply.result;
      const said = String(reply?.message ?? "Blender couldn't do that.").trim().split("\n").filter(Boolean).at(-1);
      throw new Error(said);
    },
    picturePath: () => path.join(os.tmpdir(), `buddy-blender-${process.pid}-${Date.now()}.png`),
  };
}

/** @typedef {ReturnType<typeof createBlender>} BlenderClient */

const SUMMARY = {
  blender_add: (i) => `Build in Blender: add ${listed(i.objects.map((o) => o.name))}`,
  blender_change: (i) => `Build in Blender: change ${listed(i.objects.map((o) => o.name))}`,
  blender_modifier: (i) => `Build in Blender: ${i.kind} on ${i.name}`,
  blender_light: (i) => `Build in Blender: light ${i.name}`,
  blender_camera: () => "Build in Blender: place the camera",
  blender_world: () => "Build in Blender: set the sky colour",
};
const listed = (/** @type {string[]} */ names) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

/**
 * Runs one Blender tool for the model: checks its input, asks on Buddy's card when it changes the scene, sends Buddy's
 * own Python, and says what happened. A picture of the view comes back as an image.
 * @param {string} name @param {any} input
 * @param {{ blender: BlenderClient, ask: (summary: string, note?: string, scope?: string) => Promise<boolean>, status?: (s: string) => void, signal?: AbortSignal, image?: (png: Buffer) => any }} ctx
 * @returns {Promise<string | any[]>}
 */
export async function runBlenderTool(name, input, ctx) {
  const { blender } = ctx;
  if (name === "blender_open") {
    if ((await blender.state()) === "connected") return "Blender is already open and connected: build with the blender_ tools.";
    if (!(await ctx.ask("Open Blender, with Buddy's connection on", "Buddy can then build in your scene. Each change can be undone in Blender with Ctrl+Z."))) return "The user declined.";
    ctx.status?.("Opening Blender…");
    if (await blender.open(ctx.signal)) return "Blender is open and connected. Build with the blender_ tools now.";
    return "Blender opened, but its connection didn't start. It needs Blender Lab's MCP add-on (blender.org/lab/mcp-server), installed and enabled in Blender's Preferences › Add-ons. Tell the user that in plain words.";
  }
  if ((await blender.state()) !== "connected") {
    blender.forget();
    return "Blender isn't connected. If the user wants to build, call blender_open; otherwise say Blender needs to be open.";
  }
  const checked = checkInput(name, input);
  if (typeof checked === "string") return `Not sent: ${checked}.`;
  try {
    if (name === "blender_scene") return JSON.stringify(await blender.run("scene", {}));
    if (name === "blender_view") {
      const picture = blender.picturePath();
      const r = await blender.run("view", { ...checked, picture });
      try {
        const png = fs.readFileSync(picture);
        return [ctx.image ? ctx.image(png) : { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
          { type: "text", text: `Blender's 3D view, ${r.size?.[0]} x ${r.size?.[1]}.` }];
      } finally {
        fs.rmSync(picture, { force: true });
      }
    }
    if (name === "blender_delete") {
      if (!(await ctx.ask(`Delete in Blender: ${listed(checked.names)}`, "You can bring them back in Blender with Ctrl+Z."))) return "The user declined.";
      return JSON.stringify(await blender.run("delete", checked));
    }
    const summary = SUMMARY[name]?.(checked);
    if (!summary) return `There's no Blender tool called ${name}.`;
    // One "Allow for this task" covers building for the rest of the answer: it only changes the open scene, and
    // every change is a Ctrl+Z step in Blender.
    if (!(await ctx.ask(summary, "Changes only your open Blender scene. Each change can be undone in Blender with Ctrl+Z.", "blender"))) return "The user declined.";
    ctx.status?.("Building in Blender…");
    if (name === "blender_add" || name === "blender_change") {
      const done = [];
      for (const [n, o] of checked.objects.entries()) {
        if (ctx.signal?.aborted) break;
        if (n && blender.pause) await new Promise((r) => setTimeout(r, blender.pause));
        try {
          done.push(Object.values(await blender.run(name === "blender_add" ? "add" : "change", o))[0]);
        } catch (err) {
          return `${done.length ? `Done: ${done.join(", ")}. ` : ""}Stopped at ${o.name}: ${err.message}`;
        }
      }
      return `${name === "blender_add" ? "Added" : "Changed"}: ${done.join(", ")}.`;
    }
    const op = { blender_modifier: "modifier", blender_light: "light", blender_camera: "camera", blender_world: "world" }[name];
    return `Done: ${JSON.stringify(await blender.run(/** @type {string} */ (op), checked))}`;
  } catch (err) {
    blender.forget();
    return `Blender said: ${err.message}`;
  }
}

/** What the model is told while Blender is connected. */
export const BLENDER_NOTE = `Blender is open on this PC and connected: you can build in the user's scene with the blender_ tools, live while they watch.
- Look before you build (blender_scene) and check your work after (blender_view, with shading "material" to see colours). Fix what looks wrong.
- Z is up and sizes are in metres. Stand things on the ground: an object's location is its centre, so a 3 m tall wall stands at z = 1.5. Overlap parts slightly rather than leave gaps.
- Build from big to small, in a few blender_add calls of several objects each, with clear names and shared materials ("Wood", "Stone", "Glass"). Add a light and place the camera to frame it, then show it with blender_view.
- Say what you made in a sentence or two. Never delete what the user made unless they ask; the user can undo any change with Ctrl+Z in Blender.`;
