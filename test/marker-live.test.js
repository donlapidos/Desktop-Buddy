import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { OVERLAY_SOURCE, findCompiler, overlayProgram, startOverlay } from "../src/marker-live.js";

// Live marking's native overlay (marker-live.js): built once with Windows' own C# compiler, rebuilt when its source
// changes. Drawing with it is the markerLive end-to-end check; this is the building.
const compiler = findCompiler();

test("the overlay is built once, reused, and built again (the old one removed) when its source changes", { skip: !compiler && "no .NET Framework C# compiler here", timeout: 180_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-overlay-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "marker-overlay.cs");
  fs.copyFileSync(OVERLAY_SOURCE, source);
  const cache = path.join(dir, "native");
  const first = await overlayProgram({ source, cacheDir: cache });
  assert.match(path.basename(first), /^marker-overlay-[0-9a-f]{12}\.exe$/);
  const built = fs.statSync(first).mtimeMs;
  assert.equal(await overlayProgram({ source, cacheDir: cache }), first, "the same version is reused");
  assert.equal(fs.statSync(first).mtimeMs, built, "and not built again");
  fs.appendFileSync(source, "\n// a new version\n");
  const second = await overlayProgram({ source, cacheDir: cache });
  assert.notEqual(second, first);
  assert.deepEqual(fs.readdirSync(cache), [path.basename(second)], "only the current version is kept");
});

test("a source that doesn't build says so, and nothing half-built is left to run", { skip: !compiler && "no .NET Framework C# compiler here", timeout: 120_000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-overlay-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "marker-overlay.cs");
  fs.writeFileSync(source, "class Broken { void Main( }");
  await assert.rejects(overlayProgram({ source, cacheDir: path.join(dir, "native") }), /didn't build/);
  assert.deepEqual(fs.readdirSync(path.join(dir, "native")).filter((f) => f.endsWith(".exe")), []);
});

test("without the compiler, it says why instead of failing oddly (Mark then uses the still)", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-overlay-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(overlayProgram({ cacheDir: dir, compiler: null }), /C# compiler/);
});

test("an overlay that can't start rejects instead of hanging", async () => {
  await assert.rejects(startOverlay(path.join(os.tmpdir(), "no-such-overlay.exe"), { x: 0, y: 0, width: 10, height: 10 }, { scale: 1, color: "#2f7aff", onEvent() {}, timeoutMs: 3000 }));
});
