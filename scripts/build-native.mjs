// Builds Buddy's native helpers for the installer (native.js): live marking's overlay and the commands' wall launcher,
// each named by a fingerprint of its source, into build/native, which electron-builder ships as resources/native.
// The release runs this, so the C# compiler runs on the build machine and never on a user's PC.
//
//   npm run native
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { overlayProgram } from "../src/marker-live.js";

const out = path.resolve("build/native");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const overlay = await overlayProgram({ cacheDir: out, shipped: null });
const wall = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve("src/wall.ps1"), "-WorkDir", out, "-Cache", out, "-Build"], { encoding: "utf8", windowsHide: true });
if (wall.status !== 0) throw new Error(`The wall's launcher didn't build: ${(wall.stderr || wall.stdout).trim()}`);

const built = fs.readdirSync(out);
const launcher = built.find((f) => /^BuddyWall-[0-9A-F]{16}\.dll$/.test(f));
if (!launcher || built.length !== 2) throw new Error(`Expected the overlay and the launcher in ${out}, found: ${built.join(", ") || "nothing"}`);
console.log(`Built ${path.basename(overlay)} and ${launcher} into ${out}`);
