// Checks that buddy-mcp runs from inside the packed app (resources/app.asar) on the installed exe, as Claude's apps
// start it, that the files read from disk at run time (the commands' wall, live marking's overlay source) are
// outside the archive, and that the native helpers built at release are there, matching the sources shipped beside
// them (native.js), so an installed Buddy never compiles them. Run after `electron-builder --dir`: node scripts/check-packed-helper.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BRIDGE_TOOLS, pipeName, startBridge } from "../src/bridge.js";

const exe = path.resolve("dist/win-unpacked/Desktop Buddy.exe");
const script = path.resolve("dist/win-unpacked/resources/app.asar/src/mcp-server.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-packed-"));
const bridge = startBridge({ dir, pipe: pipeName(`packed-${process.pid}`), run: async (name) => `ran ${name}` });
const client = new Client({ name: "check", version: "1" });
const start = Date.now();
await client.connect(new StdioClientTransport({ command: exe, args: [script], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", BUDDY_DATA_DIR: dir }, stderr: "inherit" }));
const tools = (await client.listTools()).tools;
const res = await client.callTool({ name: "look", arguments: {} });
const unpacked = ["wall.ps1", "marker-overlay.cs"].map((f) => [f, fs.existsSync(path.resolve("dist/win-unpacked/resources/app.asar.unpacked/src", f))]);
const native = path.resolve("dist/win-unpacked/resources/native");
const overlaySource = fs.readFileSync(path.resolve("dist/win-unpacked/resources/app.asar.unpacked/src/marker-overlay.cs"));
const overlay = `marker-overlay-${crypto.createHash("sha256").update(overlaySource).digest("hex").slice(0, 12)}.exe`;
const shipped = fs.existsSync(native) ? fs.readdirSync(native) : [];
const helpers = { overlay: shipped.includes(overlay), wall: shipped.some((f) => /^BuddyWall-[0-9A-F]{16}\.dll$/.test(f)) };
console.log({ startedMs: Date.now() - start, tools: tools.length, expected: BRIDGE_TOOLS.length, reply: res.content[0].text, unpacked: Object.fromEntries(unpacked), helpers, shipped });
await client.close();
bridge.close();
process.exit(tools.length === BRIDGE_TOOLS.length && res.content[0].text === "ran look" && unpacked.every(([, there]) => there) && helpers.overlay && helpers.wall ? 0 : 1);
