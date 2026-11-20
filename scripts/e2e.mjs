// End-to-end checks: the real app, run as separate test copies (each with its own data folder, so the user's Buddy,
// settings and files are left alone), each driven by one of main.js's BUDDY_*_TEST hooks. The runner reads what each
// copy prints, checks it, and keeps the screenshots.
//   npm run e2e                  context, conversation, files, welcome, tasks, settings, explainer, voice, island, firstrun
//   npm run e2e -- tasks voice   only those
//   npm run e2e -- --exe "<path to Desktop Buddy.exe>"   against a built or installed copy
//   npm run e2e -- --no-voice    without the voice models (CI): the voice check and hearing a language are left out
//   npm run e2e -- --interactive also the marker (a full-screen freeze frame) and approval clicks (moves the mouse)
// Windows appear briefly while it runs. Nothing touches the clipboard, real files or the mouse unless --interactive.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electron = path.join(app, "node_modules", "electron", "dist", "electron.exe");
const out = path.join(app, "e2e-out", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
// --exe <path>: run the checks against a built or installed Buddy instead of the source tree.
const exeArg = process.argv.indexOf("--exe");
const installed = exeArg >= 0 ? path.resolve(process.argv[exeArg + 1]) : null;
const realModels = path.join(process.env.APPDATA ?? "", "desktop-buddy", "models");
// --no-voice: where the voice models aren't downloaded (CI). The settings check skips hearing Spanish, and the voice
// check is left out even when named.
const noVoice = process.argv.includes("--no-voice");

// ---------- A scripted OpenAI-style model, for the files check ----------

/** Asks to write the shopping list, then, once it's written, says so. */
function scriptedModel() {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "scripted", object: "model" }] }));
    const asked = JSON.parse(body || "{}");
    const done = (asked.messages ?? []).some((m) => m.role === "tool");
    const chunk = done
      ? { choices: [{ delta: { content: "Made your shopping list." }, finish_reason: "stop" }] }
      : { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "Shopping list.txt", content: "- Eggs\n- Milk\n- Bread\n" }) } }] }, finish_reason: "tool_calls" }] };
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`, close: () => server.close() })));
}

/** An Ollama-style server on "this PC": one model that can use tools, which says hello. */
function scriptedOllama() {
  let showMe = 0; // questions asked with the tour's "Show me" note (brain.js SHOW_OFF)
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    // The newest question only: later requests carry the conversation so far.
    let newest = null;
    try { newest = (JSON.parse(body || "{}").messages ?? []).filter((m) => m.role === "user").at(-1); } catch {}
    if (JSON.stringify(newest?.content ?? "").includes('pressed \\"Show me\\" on your first tip')) showMe++;
    if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "scripted-local", object: "model" }] }));
    if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
    res.setHeader("content-type", "text/event-stream");
    const said = { choices: [{ delta: { content: "Hello from a model on this PC." }, finish_reason: "stop" }] };
    const usage = { choices: [], usage: { prompt_tokens: 1500, completion_tokens: 20 } };
    res.end(`data: ${JSON.stringify(said)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`, showMe: () => showMe, close: () => server.close() })));
}

/** Asks to search the test service's documents, then says what it found: for the connections check. */
function toolModel() {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "scripted", object: "model" }] }));
    const asked = JSON.parse(body || "{}");
    const result = (asked.messages ?? []).find((m) => m.role === "tool");
    const chunk = result
      ? { choices: [{ delta: { content: `Found it. ${String(result.content).split("\n")[1] ?? ""}` }, finish_reason: "stop" }] }
      : { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "testdocs__search_docs", arguments: JSON.stringify({ query: "budget" }) } }] }, finish_reason: "tool_calls" }] };
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`, close: () => server.close() })));
}

/** Answers each question with "Answer to: <the question>" and keeps every request, for the restore check. */
function echoModel() {
  /** @type {string[]} */
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "scripted", object: "model" }] }));
    requests.push(body);
    const last = (JSON.parse(body || "{}").messages ?? []).filter((m) => m.role === "user").at(-1);
    const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p) => p.text ?? "").join("\n");
    const said = { choices: [{ delta: { content: `Answer to: ${text.trim().split("\n").at(-1)}` }, finish_reason: "stop" }] };
    res.setHeader("content-type", "text/event-stream");
    res.end(`data: ${JSON.stringify(said)}\n\ndata: [DONE]\n\n`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`, requests, close: () => server.close() })));
}

// ---------- Running one test copy ----------

/**
 * Runs Buddy with `env` until it prints `done` (or `timeoutMs` passes), and returns what it printed, by marker.
 * Every copy's own timing.log is read afterwards: a refused mode or task-state change is a bug, whichever check hit it.
 * `devHooks` says whether the copy loaded dev-hooks.js (it writes dev-hooks-loaded to its timing log when it does).
 * `reuse` runs the copy on an earlier copy's data folder (`data` in what that run resolved): Buddy restarting.
 * @returns {Promise<{ markers: Record<string, any[]>, log: string, timedOut: boolean, devHooks: boolean, data: string }>}
 */
function runCopy(name, env, done, timeoutMs = 90_000, seed = {}, reuse = null) {
  const data = reuse ?? fs.mkdtempSync(path.join(os.tmpdir(), `buddy-e2e-${name}-`));
  // `seed`: files the copy's data folder starts with (an existing profile's settings.json, say).
  for (const [file, text] of Object.entries(seed)) fs.writeFileSync(path.join(data, file), text);
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC|OPENAI|OPENROUTER|GEMINI|DEEPSEEK)_|^BUDDY_/.test(k)));
  // The source tree on Electron, or (--exe) a built or installed Buddy.
  const child = spawn(installed ?? electron, [...(installed ? [] : ["."]), `--user-data-dir=${data}`], {
    cwd: installed ? path.dirname(installed) : app,
    env: { ...clean, BUDDY_E2E: "1", ...(fs.existsSync(realModels) ? { BUDDY_MODELS_DIR: realModels } : {}), ...(noVoice ? { BUDDY_E2E_NO_VOICE: "1" } : {}), ...env },
    windowsHide: false,
  });
  let log = "";
  /** @type {Record<string, any[]>} */
  const markers = {};
  return new Promise((resolve) => {
    let finished = false;
    const finish = (timedOut) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      fs.writeFileSync(path.join(out, `${name}.log`), log);
      let timing = "";
      try {
        timing = fs.readFileSync(path.join(data, "timing.log"), "utf8");
        for (const line of timing.split(/\r?\n/)) {
          if (/"kind":"refused-(mode-change|task-state)"/.test(line)) refusals.push(`${name}: ${line}`);
        }
      } catch {}
      resolve({ markers, log, timedOut, devHooks: timing.includes('"kind":"dev-hooks-loaded"'), data });
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    const read = (chunk) => {
      log += chunk;
      for (const line of String(chunk).split(/\r?\n/)) {
        const m = line.match(/^([A-Z][A-Z_]+)\s*(.*)$/);
        if (!m) continue;
        let value = m[2];
        try {
          value = JSON.parse(m[2]);
        } catch {}
        (markers[m[1]] ??= []).push(value);
        if (m[1] === done) setTimeout(() => finish(false), 300);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", (d) => (log += d));
    child.on("exit", () => setTimeout(() => finish(false), 200));
  });
}

/** Refused state changes seen in any copy's log (see runCopy). */
const refusals = [];

/** The user's start-with-Windows entries and Buddy shortcuts, to see that a check left them alone. */
function machineState() {
  /** @type {Record<string, string>} */
  const state = {};
  const run = spawnSync("reg", ["query", String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`], { encoding: "utf8", windowsHide: true }).stdout ?? "";
  for (const line of run.split(/\r?\n/)) {
    const m = line.match(/^\s+(.+?)\s+REG_\w+\s+(.*)$/);
    if (m) state[`Run: ${m[1]}`] = m[2];
  }
  const desktop = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8", windowsHide: true }).stdout.trim();
  for (const dir of [desktop, path.join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs")]) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /buddy/i.test(n)) : []) state[path.join(dir, f)] = String(fs.statSync(path.join(dir, f)).mtimeMs);
  }
  return state;
}

// ---------- The checks ----------

// A key saved for "Other server" at one address is sent there, not to another, and is there again on the way back.
function keyProblems(k) {
  if (!k) return ["the key check printed nothing"];
  return [
    (!k.atA.key.saved || k.atA.sent !== "key-for-server-a-0123456789") && "the key wasn't used at its own address",
    k.atB.sent !== null && "the key was sent to another address",
    k.atB.key.elsewhere !== "https://a.example" && `Settings didn't say where the key belongs (${k.atB.key.elsewhere})`,
    k.backAtA.sent !== "key-for-server-a-0123456789" && "the key didn't come back at its own address",
  ].filter(Boolean);
}

/** @type {Record<string, { interactive?: boolean, run: () => Promise<string[]> }>} each resolves its problems */
const CHECKS = {
  async markerStartup() {
    const { markers, timedOut } = await runCopy("marker-startup", { BUDDY_MARK_STARTUP_TEST: "1", ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "MARK_STARTUP_TEST_DONE", 60000);
    const r = markers.MARK_STARTUP_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "no marker startup result"];
    return [r.error, ...["loadedDuringCapture", "cancelledPromptly", "replacementSurvived", "imageReady", "closed", "unreadyRecovered", "sharedCaptureStarted",
      "captureCancelled", "newCaptureStillHidden", "lateCaptureIgnored", "captureReleased", "missingDisplayRejected"].filter((key) => !r[key]).map((key) => `${key} failed`)].filter(Boolean);
  },
  async markerLive() {
    const problems = [];
    const { markers, timedOut } = await runCopy("marker-live", { BUDDY_MARK_LIVE_TEST: "1", ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "MARK_LIVE_TEST_DONE", 150_000);
    const r = markers.MARK_LIVE_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "no live marker result"];
    problems.push(...[r.error,
      !r.live && "the live overlay didn't start", !r.bar && "its toolbar didn't show", !r.barCounted && "the toolbar didn't count the stroke",
      !(r.onStroke >= 80) && `the stroke wasn't drawn (alpha ${r.onStroke})`, !(r.beside <= 2) && `the overlay drew where nothing was marked (alpha ${r.beside})`,
      !(r.afterUndo <= 2) && `Undo left the stroke on screen (alpha ${r.afterUndo})`,
      !(r.stats?.avgMs < 8) && `drawing was slow: ${JSON.stringify(r.stats)}`,
      !r.asked && "Ask didn't hand the marks to the question", r.marks !== 1 && `${r.marks} marks, not 1`,
      !(r.bluePixels - r.bluePixelsWithout > 1500) && `the picture for the question doesn't show the stroke (${r.bluePixels} blue pixels with it, ${r.bluePixelsWithout} without)`,
      !r.overlayGone && "the overlay stayed after Ask", !r.barGone && "the toolbar stayed after Ask",
      !r.cancelled && "Cancel didn't end marking", !r.cancelOverlayGone && "the overlay stayed after Cancel",
      !r.clickLeft && "a quick click didn't explain", !r.clickOverlayGone && "the overlay stayed after a click",
      // An installed Buddy runs the overlay built at release and compiles nothing on the PC (src/native.js).
      installed && !/[\\/]resources[\\/]native[\\/]marker-overlay-[0-9a-f]{12}\.exe$/i.test(r.exe ?? "") && `the installed copy didn't run its shipped overlay (${r.exe})`,
      installed && r.compiled?.length && `the installed copy compiled ${r.compiled.join(", ")}`].filter(Boolean));
    const fallback = await runCopy("marker-live-fallback", { BUDDY_MARK_LIVE_TEST: "1", BUDDY_MARK_LIVE_FAIL: "1", ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "MARK_LIVE_TEST_DONE", 60_000);
    const f = fallback.markers.MARK_LIVE_TEST?.[0];
    if (!f?.fellBack || !f.noLive) problems.push(`when the overlay can't start, the still didn't take over: ${JSON.stringify(f)}`);
    return problems;
  },
  async markerRender() {
    const { markers, timedOut } = await runCopy("marker-render", { BUDDY_MARK_RENDER_TEST: out }, "MARK_RENDER_TEST_DONE", 60000);
    const r = markers.MARK_RENDER_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "no marker renderer result"];
    return [r.error, r.results?.length !== 2 && "missing standard or high-DPI check",
      ...(r.results ?? []).flatMap((result, i) => [Math.abs(result.dpr - result.canvasScale) > .01 && "canvas DPI mismatch",
        Math.abs(result.canvasScale - (i + 1)) > .01 && "requested DPI scale was not exercised",
        result.frames < 30 && "live frames were not exercised",
        result.strokeCalls > 100 && "completed marks were repainted during every live frame",
        ...["cancelDiscarded", "pointerIsolated", "undoWorked", "tipTracked", "pointsBounded", "coalescedFallback", "composed", "composedMarksVisible", "liveVisible", "savedVisible", "activeCleared"].filter((key) => !result[key]).map((key) => `${key} failed at DPI ${result.canvasScale}`)]),
    ].filter(Boolean);
  },
  async annotations() {
    const { markers, timedOut } = await runCopy("annotations", { BUDDY_ANNOTATIONS_TEST: out, BUDDY_ANNOTATIONS_SAMPLE: path.join(app, "scripts/samples/context-window.ps1") }, "ANNOTATIONS_TEST_DONE", 120_000);
    const r = markers.ANNOTATIONS_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "no annotation result"];
    return [r.error, ...["highlight", "circle", "arrow", "label", "drag"].filter((kind) => !r.kinds?.includes(kind)).map((kind) => `${kind} didn't render`),
      !r.escaped && "a label wasn't rendered safely as text", !r.ownerIsolated && "another task's drawings were cleared",
      !r.sampleClick && "the sample's semantic click failed", !/^They finished all 1 steps/.test(r.route ?? "") && `the route didn't verify completion: ${r.route}`,
      !r.routeCleared && "a finished route left drawings behind", !r.cancelCleared && "interruption left drawings behind",
      !r.noLateCaption && "a cancelled flight showed a late caption", !r.movementCleared && "a moved anchor kept its old drawing",
      !r.focusCleared && "switching to another window left the old drawing visible",
    ].filter(Boolean);
  },
  async context() {
    const observations = [];
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "vision-fixture" }] }));
      const messages = JSON.parse(body || "{}").messages ?? [];
      const images = messages.flatMap((m) => Array.isArray(m.content) ? m.content.filter((c) => c.type === "image_url") : []);
      const text = messages.map((m) => typeof m.content === "string" ? m.content : (m.content ?? []).map((c) => c.text ?? "").join("\n")).join("\n");
      res.setHeader("content-type", "text/event-stream");
      // Pointing by sight: the question carries the spot the check found in the picture; point there.
      const lastUser = messages.filter((m) => m.role === "user").at(-1);
      const asked = typeof lastUser?.content === "string" ? lastUser.content : (lastUser?.content ?? []).map((c) => c.text ?? "").join("\n");
      const spot = asked.match(/\[spot ([\d.]+),([\d.]+)\]/);
      if (spot) {
        if (messages.at(-1)?.role === "tool") return res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "That's the blue bar." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
        const args = { spot: { x: Number(spot[1]), y: Number(spot[2]) }, caption: "The blue bar", then_say: "That's the blue bar." };
        return res.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "spot_1", type: "function", function: { name: "point_at", arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
      }
      observations.push({ images: images.length, jpeg: images.some((i) => /^data:image\/jpeg;base64,/.test(i.image_url?.url ?? "") && i.image_url.url.length > 1000), tree: text.includes("Quarterly sales") && /@s[a-z0-9]+:e\d+/i.test(text) });
      const content = images.length ? "Visual context received." : "Text-only context received.";
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`;
      const { markers, timedOut } = await runCopy("context", { BUDDY_SCREEN_CONTEXT_TEST: url, BUDDY_SCREEN_CONTEXT_SAMPLE: path.join(app, "scripts/samples/context-window.ps1"), BUDDY_SCREEN_CONTEXT_TEST_OUT: path.join(out, "context-settings.png") }, "SCREEN_CONTEXT_TEST_DONE");
      const r = markers.SCREEN_CONTEXT_TEST?.[0];
      if (!r) return [timedOut ? "timed out" : "no visual context result"];
      return [r.error, r.first !== "Visual context received." && "the first question didn't carry a screenshot",
        !observations[0]?.jpeg && "the sample screenshot wasn't sent as a bounded JPEG",
        !observations[0]?.tree && "the first question didn't carry the sample's real accessibility refs",
        !r.largeImageBounded && "a large screenshot wasn't resized within the image budget",
        r.second !== "Text-only context received." && "turning screenshots off didn't remove old and new images",
        r.sight?.error && `pointing by sight: ${r.sight.error}`,
        r.sight && !r.sight.error && !r.sight.inside && `pointing by sight landed at ${JSON.stringify(r.sight.pointedAt)}, outside the blue bar ${JSON.stringify(r.sight.bar)}`,
        r.sight && !r.sight.error && !r.sight.softRing && "a pointer by sight wasn't shown as a best guess",
        r.sight && !r.sight.error && !/about here/.test(r.sight.caption ?? "") && `a pointer by sight said ${JSON.stringify(r.sight.caption)}, not "about here"`,
        r.sight && !r.sight.error && !r.sight.cleared && "a pointer by sight stayed up: it wasn't let go",
        !r.settingWasOn && "the screenshot setting wasn't initially on", !r.settingOff && "the setting didn't switch off", !r.settingUIOff && "the switch didn't display its saved off state", !r.savedOff && "the setting wasn't saved",
      ].filter(Boolean);
    } finally { server.closeAllConnections(); server.close(); }
  },
  async conversation() {
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "scripted" }] }));
      if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: ["completion", "tools"] }));
      const messages = JSON.parse(body || "{}").messages ?? [];
      const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((c) => c.text ?? "").join("\n"));
      const last = textOf(messages.filter((m) => m.role === "user").at(-1));
      res.setHeader("content-type", "text/event-stream");
      const chunk = (text, finish = null) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
      if (last.includes("Change direction")) return res.end(chunk("Here is the corrected answer.", "stop"));
      // The guided question: point at the sample's details button, by the ref Buddy read from the window.
      if (last.includes("Where are the details?")) {
        if (messages.at(-1)?.role === "tool") return res.end(chunk("There they are.", "stop"));
        const ref = last.match(/(@\S+) button "Quarterly sales details"/)?.[1];
        if (!ref) return res.end(chunk("I couldn't read the window.", "stop"));
        const call = { index: 0, id: "call_point", type: "function", function: { name: "point_at", arguments: JSON.stringify({ ref, caption: "The details are here", then_say: "There they are." }) } };
        return res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`);
      }
      res.write(chunk("The first sentence is visible. "));
      const timer = setTimeout(() => res.end(chunk("The old answer finished.", "stop")), 15_000);
      res.on("close", () => clearTimeout(timer));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try {
      const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`;
      const { markers, timedOut } = await runCopy("conversation", { BUDDY_CONVERSATION_TEST: url, BUDDY_CONVERSATION_TEST_OUT: path.join(out, "conversation.png"),
        BUDDY_CONVERSATION_SAMPLE: path.join(app, "scripts/samples/context-window.ps1") }, "CONVERSATION_TEST_DONE");
      const r = markers.CONVERSATION_TEST?.[0];
      if (!r) return [timedOut ? "timed out" : "no conversation result"];
      const fp = r.firstPointer;
      return [!r.partial && "text wasn't visible before completion", !r.editable && "the input was disabled while answering", !r.corrected && "the correction didn't replace the old answer", r.error,
        r.guided !== "There they are." && `the guided answer said ${JSON.stringify(r.guided)}`,
        !fp && "a guided answer left no first-pointer entry in the timing log",
        fp && !["ms", "contextMs", "modelMs", "pointMs"].every((k) => Number.isFinite(fp[k])) && `the first-pointer entry is missing a part: ${JSON.stringify(fp)}`,
        fp && (fp.voice !== false || fp.provider !== "ollama" || fp.model !== "scripted") && `the first-pointer entry has the wrong question facts: ${JSON.stringify(fp)}`,
        fp && fp.ms < fp.pointMs && `the first-pointer total is less than its pointing part: ${JSON.stringify(fp)}`,
        !r.glanceReused && "a question asked while the bubble kept focus read the window again instead of using the glance",
      ].filter(Boolean);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  },
  async files() {
    const model = await scriptedModel();
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-e2e-docs-"));
    try {
      const { markers, timedOut } = await runCopy("files", { BUDDY_FILES_TEST: model.url, BUDDY_DOCUMENTS_DIR: docs, BUDDY_FILES_TEST_OUT: path.join(out, "files-activity.png") }, "FILES_TEST_DONE");
      const r = markers.FILES_TEST?.[0];
      if (!r) return [timedOut ? "timed out before the check finished" : "the check printed nothing"];
      return [
        !/^Create Shopping list\.txt in /.test(r.card ?? "") && `approval card said ${JSON.stringify(r.card)}`,
        r.otherWindowRefused !== true && "another Buddy window could answer the bubble's approval card",
        r.reply !== "Made your shopping list." && `reply was ${JSON.stringify(r.reply)}`,
        !/Eggs[\s\S]*Milk[\s\S]*Bread/.test(r.made ?? "") && "the file wasn't made with the list",
        !(markers.REVEALED?.[0] ?? []).some((f) => f.endsWith("Shopping list.txt")) && "the made file wasn't shown",
        r.listed?.[0]?.kind !== "created" && "Activity didn't list the new file",
        !/Created Shopping list\.txt/.test(r.page ?? "") && "the Activity page didn't show it",
        !r.undone?.ok && `undo failed: ${r.undone?.message}`,
        !r.goneAfterUndo && "the file was still there after undo",
      ].filter(Boolean);
    } finally {
      model.close();
    }
  },

  // First-run setup: a fresh Buddy offers three ways in, never a bare key field, and each way works.
  async welcome() {
    const model = await scriptedOllama();
    // A made-up home with a Gemini CLI folder: the AI-app choice adds Buddy there, never to the user's own apps.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-e2e-home-"));
    fs.mkdirSync(path.join(home, ".gemini"));
    try {
      const { markers, timedOut } = await runCopy("welcome", { BUDDY_WELCOME_TEST: model.url, BUDDY_APPS_HOME: home, BUDDY_WELCOME_TEST_OUT: out }, "WELCOME_TEST_DONE");
      const r = markers.WELCOME_TEST?.[0];
      if (!r) return [timedOut ? "timed out before the check finished" : "the check printed nothing"];
      return [
        JSON.stringify(r.doors) !== '["apps","local","key"]' && `the doors were ${JSON.stringify(r.doors)}`,
        r.keyFieldAtStart && "a fresh Buddy showed the key field before a way in was chosen",
        JSON.stringify(r.apps) !== '["Gemini CLI"]' && `the AI apps found were ${JSON.stringify(r.apps)}`,
        !/^Buddy is in Gemini CLI\./.test(r.appText ?? "") && `after adding: ${JSON.stringify(r.appText)}`,
        !r.appEntry?.args?.[0]?.endsWith("mcp-server.js") && `Gemini CLI's settings didn't get Buddy: ${JSON.stringify(r.appEntry)}`,
        !/^That doesn't look like an API key\. .*sk.ant./.test(r.badKey ?? "") && `a bad key said ${JSON.stringify(r.badKey)}`,
        r.badKeyShown !== true && "the bad-key message wasn't visible in the bubble",
        !/Ollama is running/.test(r.localText ?? "") && `Free, on this PC said ${JSON.stringify(r.localText)}`,
        (!r.localReady?.brain || r.localReady.provider !== "ollama") && `the model on this PC wasn't set up: ${JSON.stringify(r.localReady)}`,
        r.localReply !== "Hello from a model on this PC." && `the model on this PC answered ${JSON.stringify(r.localReply)}`,
        r.localSpend !== "1.5k tokens · free, on this PC" && `the answer's cost line said ${JSON.stringify(r.localSpend)}`,
        // Show me and one question: two model calls of 1.5k tokens each.
        !/3k tokens over 2 model calls/.test(r.spendSettings?.month ?? "") && `Settings' month said ${JSON.stringify(r.spendSettings?.month)}`,
        !/runs on this PC, so it costs nothing/.test(r.spendSettings?.note ?? "") && `Settings' spending note said ${JSON.stringify(r.spendSettings?.note)}`,
        !/^Try it: ask me how to do something in .*Skip tour$/s.test(r.tipAfterSetup ?? "") && `after setup, the tour said ${JSON.stringify(r.tipAfterSetup)}`,
        r.showMeButton !== "Show me" && `the first tip's Show me button was ${JSON.stringify(r.showMeButton)}`,
        model.showMe() !== 1 && `Show me sent ${model.showMe()} question(s) with its note, not 1`,
        r.showMeReply !== "Hello from a model on this PC." && `Show me's answer was ${JSON.stringify(r.showMeReply)}`,
        !/draw around/.test(r.showMeTip ?? "") && `after Show me, the tour said ${JSON.stringify(r.showMeTip)}`,
        r.voiceSetupAtStart !== "ask" && `a new profile's voice download was ${JSON.stringify(r.voiceSetupAtStart)}, not offered`,
        !/275 MB/.test(r.voiceOffer ?? "") && `after setup, the voice offer said ${JSON.stringify(r.voiceOffer)}`,
        (!r.voiceDeclined?.hidden || r.voiceDeclined.setting !== "no" || r.voiceDeclined.fetches !== 0) && `"Not now" didn't leave the voice alone: ${JSON.stringify(r.voiceDeclined)}`,
        (!/^Talking is ready/.test(r.voiceAccepted?.text ?? "") || r.voiceAccepted.setting !== "yes" || r.voiceAccepted.fetches !== 1 || !r.voiceAccepted.buttons) && `"Set up talking" didn't fetch the voice once: ${JSON.stringify(r.voiceAccepted)}`,
        !/press Ctrl\+Alt\+M, then draw around.*Got it$/s.test(r.tipAfterAnswer ?? "") && `after the first answer, the tour said ${JSON.stringify(r.tipAfterAnswer)}`,
        (r.tipAfterGotIt !== null || r.tourStep !== "done") && `"Got it" didn't end the tour (${r.tourStep}: ${JSON.stringify(r.tipAfterGotIt)})`,
        r.tipAfterSecondSetup !== null && `setting up again brought the tour back: ${JSON.stringify(r.tipAfterSecondSetup)}`,
        !r.doorsAgain && "without an AI again, the doors didn't come back",
        (!r.keyReady?.brain || r.keyReady.provider !== "anthropic") && `the key wasn't taken: ${JSON.stringify(r.keyReady)}`,
      ].filter(Boolean);
    } finally {
      model.close();
      fs.rmSync(home, { recursive: true, force: true });
    }
  },

  async tasks() {
    const { markers, timedOut } = await runCopy("tasks", { BUDDY_TASK_TEST: out }, "TASK_TEST_DONE");
    const last = markers.TASKS?.at(-1);
    if (!last) return [timedOut ? "timed out" : "no task list printed"];
    // A finished task reads "done" until its window is seen, then "idle"; the check shows both windows at the end.
    const want = { t1: /^The Pro plan is the only one with SSO/, t2: /^Saved the file as report-final\.xlsx/ };
    const first = markers.TASKS[0] ?? [];
    return [
      last.length !== 2 && `expected 2 tasks, got ${last.length}`,
      first.find((t) => t.id === "t2")?.state !== "confirm" && "task 2 didn't wait for approval",
      ...last.filter((t) => !["done", "idle"].includes(t.state) || !want[t.id]?.test(t.line ?? "")).map((t) => `${t.title} ended "${t.state}": ${t.line}`),
      ...["task-2-confirm.png", "island-peek-confirm.png", "task-1-done.png"].filter((f) => !fs.existsSync(path.join(out, f))).map((f) => `no ${f}`),
    ].filter(Boolean);
  },

  async settings() {
    const { markers, timedOut } = await runCopy("settings", { BUDDY_SETTINGS_TEST: out }, "SETTINGS_TEST_DONE", 180_000);
    const applied = markers.SETTINGS_APPLIED?.[0];
    if (!applied) return [timedOut ? "timed out" : "no settings result printed"];
    const coral = "#f2545b";
    const policy = markers.SETTINGS_POLICY?.[0] ?? {};
    const lang = markers.SETTINGS_LANGUAGE?.[0] ?? {};
    return [
      Object.keys(applied.problems ?? {}).length && `changes refused: ${JSON.stringify(applied.problems)}`,
      ...["island", "bubble", "settingsPage"].filter((w) => applied[w]?.toLowerCase() !== coral).map((w) => `${w} accent is ${applied[w]}, not coral`),
      !applied.newAskHeld && "the new Ask shortcut wasn't registered",
      applied.file?.accent !== "coral" && "the accent wasn't saved",
      !markers.SETTINGS_CLASH?.[0]?.["hotkeys.talk"] && "a clashing shortcut wasn't refused",
      policy.notepadType !== "allow" && `trusted Notepad typing: ${policy.notepadType}`,
      policy.wordType !== "ask" && `Word typing: ${policy.wordType}`,
      policy.keepass !== "block" && `KeePass: ${policy.keepass}`,
      !markers.SETTINGS_ROUTINE?.[0]?.started && "the routine didn't report anything",
      ...(() => {
        const f = markers.SETTINGS_FOLDERS?.[0];
        if (!f) return ["no folders result printed"];
        return [
          !f.problem && "AppData was put on the folders Buddy reads without asking",
          JSON.stringify(f.list) !== JSON.stringify([f.projects]) && `folders kept: ${JSON.stringify(f.list)}`,
          JSON.stringify(f.chips) !== JSON.stringify([f.projects]) && `Settings shows folders: ${JSON.stringify(f.chips)}`,
        ];
      })(),
      lang.lang && lang.lang !== "es" && `Spanish heard as ${lang.lang}`,
      !lang.text && !(noVoice && lang.skipped) && "nothing heard in the language check (are the voice models downloaded?)",
      !fs.existsSync(path.join(out, "settings-claude.png")) && "no Settings screenshots",
      !markers.SETTINGS_REPORT?.[0]?.shown && "Report a problem didn't show its preview",
      markers.SETTINGS_REPORT?.[0]?.shown && !markers.SETTINGS_REPORT[0].version && "the problem report didn't say Buddy's version",
      markers.SETTINGS_REPORT?.[0]?.shown && !markers.SETTINGS_REPORT[0].timing && "the problem report had no timing log",
      markers.SETTINGS_REPORT?.[0]?.key && "the problem report carried a saved key",
      markers.SETTINGS_REPORT?.[0]?.home && "the problem report carried a path in the user's folder",
      ...keyProblems(markers.SETTINGS_KEYS?.[0]),
    ].filter(Boolean);
  },

  async explainer() {
    // Opened in Light (Settings › Look › Explainer appearance), then switched to Dark while the plate is open.
    const seed = { "settings.json": JSON.stringify({ appearance: "light", launchSetupDone: true, voiceSetup: "no" }) };
    const { markers, timedOut, devHooks } = await runCopy("explainer", { BUDDY_EXPLAINER_TEST: path.join(app, "scripts", "samples", "vlookup.json"), BUDDY_EXPLAINER_TEST_OUT: path.join(out, "explainer.png") }, "EXPLAINER_TEST_DONE", 90_000, seed);
    const r = markers.EXPLAINER_SHOWN?.[0];
    if (!r) return [timedOut ? "timed out" : "nothing printed"];
    return [!devHooks && "a dev check ran without dev-hooks.js reporting itself loaded", !r.windows && "no explainer window opened", !r.visible && "the explainer window isn't visible", r.chars < 100 && `only ${r.chars} characters on the plate`,
      r.opened?.dark !== false && `a plate opened in Light read as dark (${JSON.stringify(r.opened)})`,
      r.switched?.dark !== true && `switching to Dark left the open plate light (${JSON.stringify(r.switched)})`,
      r.opened?.paper === r.switched?.paper && `the plate's paper stayed ${r.opened?.paper} through the switch`,
    ].filter(Boolean);
  },

  async voice() {
    const line = "Click the Formulas tab, then choose Insert Function.";
    // Talking needs an AI set up (without one, Buddy opens the bubble to ask for a key); no call is made.
    const { markers, timedOut } = await runCopy("voice", { BUDDY_VOICE_TEST: line, BUDDY_HOLD_TIMEOUT_MS: "2000", ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "VOICE_TEST_DONE", 150_000);
    const heard = String(markers.VOICE_HEARD?.[0] ?? "").toLowerCase();
    if (!markers.VOICE_SYNTH) return [timedOut ? "timed out (are the voice models downloaded?)" : "nothing spoken"];
    const hold = markers.VOICE_HOLD?.[0];
    const join = markers.VOICE_JOIN?.[0];
    return [!heard.includes("formulas") && `heard ${heard || "nothing"}`, !markers.VOICE_SAID && "the reply wasn't played",
      !join && "the follow-on check printed nothing",
      join && !(join.gapMs < 300) && `a sentence joining the one being said left a silence of ${join.gapMs} ms before it`,
      join && join.joinedMs < join.playMs - 200 && `joining cut a sentence short (${join.joinedMs} ms for ${join.playMs} ms of audio)`,
      join && join.hushedMs > join.playMs / 2 && `a joined reply went on after being hushed (${join.hushedMs} ms)`,
      !hold && "the hold-to-talk check printed nothing",
      hold && !hold.idleBefore && "the keyboard hook was installed before any key was pressed",
      hold && !hold.installedWhileDown && "the keyboard hook wasn't installed while the key was down",
      hold && hold.held !== "listen,hold,finish" && `holding and letting go did ${hold.held}, not listen, hold, finish`,
      hold && !hold.idleAfterHold && "after letting go, the hook stayed or Buddy didn't return to rest",
      hold && hold.tapped !== "listen" && `a tap did ${hold.tapped}, not just listen`,
      hold && !hold.hookGoneAfterTap && "the hook stayed after a tap",
      hold && hold.timedOut !== "listen,hold,finish" && `a release that never came did ${hold.timedOut}, not listen, hold, finish`,
      hold && !hold.idleAfterTimeout && "after the release timed out, the hook stayed or Buddy kept listening",
    ].filter(Boolean);
  },

  // A new profile's island offers the core actions only (Ask, Talk, Mark), and Settings no routines; a profile from
  // before the switch keeps everything.
  async island() {
    const problems = [];
    for (const [name, seed, advanced] of [["island-new", {}, false], ["island-existing", { "settings.json": JSON.stringify({ voice: 2 }) }, true]]) {
      // With an AI set up (a key that is never used), so the bubble opens as it does day to day, not on the welcome.
      const { markers, timedOut } = await runCopy(name, { BUDDY_ISLAND_TEST: path.join(out, `${name}.png`), ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "ISLAND_TEST_DONE", 60_000, seed);
      const r = markers.ISLAND_TEST?.[0];
      if (!r) { problems.push(`${name}: ${timedOut ? "timed out" : "nothing printed"}`); continue; }
      const want = advanced ? ["ask", "talk", "mark", "task"] : ["ask", "talk", "mark"];
      if (r.error) problems.push(`${name}: ${r.error}`);
      if (JSON.stringify(r.actions) !== JSON.stringify(want)) problems.push(`${name}: the island offered ${JSON.stringify(r.actions)}, not ${JSON.stringify(want)}`);
      if (r.routines !== advanced) problems.push(`${name}: Settings ${r.routines ? "showed" : "hid"} Routines`);
      if (r.makeTask !== advanced) problems.push(`${name}: the bubble ${r.makeTask ? "showed" : "hid"} Make task`);
      if (!r.closeShown || !r.closed) problems.push(`${name}: the bubble's close button ${r.closeShown ? "didn't fold it back into the island" : "wasn't there"}`);
      if (r.advanced !== advanced) problems.push(`${name}: the advanced setting was ${r.advanced}`);
      if (!fs.existsSync(path.join(out, `${name}.png`))) problems.push(`${name}: no picture of the island`);
    }
    return problems;
  },

  // A plain test copy (no dev hook, its own data folder) must leave the user's PC as it was: no start-with-Windows
  // entry, no shortcuts. One once did, and would have started a second Buddy at every sign-in. It must not load the
  // dev hooks either: they are for checks only.
  async firstrun() {
    const before = machineState();
    const { devHooks } = await runCopy("firstrun", {}, "NEVER", 12_000);
    const after = machineState();
    return [devHooks && "a Buddy with no test variable loaded dev-hooks.js",
      ...Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).map((k) => `changed ${k}: ${before[k] ?? "(none)"} -> ${after[k] ?? "(none)"}`)].filter(Boolean);
  },

  // A service connected and used through the real app, against a stand-in service and model on this PC.
  async connections() {
    const { startTestService } = await import("./samples/test-service.mjs");
    const service = await startTestService();
    // And one that takes only the user's own app, as HubSpot does, coming back to a fixed port.
    const ownPort = await new Promise((resolve) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    const own = await startTestService({ app: { clientId: "hub-client", clientSecret: "hub-secret-123", redirect: `http://localhost:${ownPort}/callback` } });
    const model = await toolModel();
    try {
      const seed = { "settings.json": JSON.stringify({ provider: "custom", providerURLs: { custom: model.url }, providerModels: { custom: "scripted" }, advanced: true, launchSetupDone: true, voiceSetup: "no", talkBack: "never" }) };
      const { markers, timedOut } = await runCopy("connections", { BUDDY_CONNECTIONS_TEST: "1", BUDDY_CONNECTORS_TEST: service.url, BUDDY_CONNECTORS_OWN_TEST: `${own.url} ${ownPort}`, BUDDY_CONNECTIONS_TEST_OUT: path.join(out, "connections-setup.png") }, "CONNECTIONS_TEST_DONE", 120_000, seed);
      const r = markers.CONNECTIONS_TEST?.[0];
      if (!r) return [timedOut ? "timed out" : "nothing printed"];
      if (r.error) return [r.error];
      return [
        !r.offered && "the bubble didn't offer to connect on the service's site",
        !/^Connect Buddy to Test Docs\?/.test(r.offer ?? "") && `the offer said ${JSON.stringify(r.offer)}`,
        !r.connected && "Connect didn't sign in",
        service.seen.registered !== 1 && `Buddy registered ${service.seen.registered} times`,
        !/^Connected/.test(r.after ?? "") && `after connecting the bubble said ${JSON.stringify(r.after)}`,
        r.card !== "Test Docs: Search documents" && `the approval card said ${JSON.stringify(r.card)}`,
        JSON.stringify(service.seen.calls) !== JSON.stringify([{ name: "search_docs", args: { query: "budget" } }]) && `the service saw ${JSON.stringify(service.seen.calls)}`,
        !/Forecast sheet/.test(r.reply ?? "") && `the answer was ${JSON.stringify(r.reply)}`,
        !(r.listed ?? []).includes("testdocs:true") && `Settings listed ${JSON.stringify(r.listed)}`,
        // The service that takes only the user's own app, set up in Settings.
        !r.own && "the own-app connection printed nothing", r.own?.error,
        r.own && r.own.before?.buttons?.includes("Connect") && "Connect was offered before the service was set up",
        r.own && r.own.before?.returnUrl !== `http://localhost:${ownPort}/callback` && `Settings showed the return address ${JSON.stringify(r.own.before?.returnUrl)}`,
        r.own && !/both/.test(r.own.emptyRefused ?? "") && `an empty secret wasn't refused (${JSON.stringify(r.own.emptyRefused)})`,
        r.own && !r.own.saved && "Save didn't set it up (no Connect button after)",
        r.own && !r.own.connected && "Connect didn't sign in with the app that was set up",
        own.seen.registered !== 0 && `Buddy tried to register with the own-app service (${own.seen.registered} times)`,
        r.own?.connected && own.seen.tokens !== 1 && `the own-app service issued ${own.seen.tokens} tokens`,
        r.own && !/Connected/.test(r.own.after ?? "") && `after connecting, Settings said ${JSON.stringify(r.own.after)}`,
      ].filter(Boolean);
    } finally {
      model.close();
      service.close();
      own.close();
    }
  },

  // Every control in Settings used as a person would, each one saved, shown, and taking effect (dev-hooks.js
  // settingsAuditTest). It starts from a profile where every step is a change.
  async controls() {
    const seed = {
      "settings.json": JSON.stringify({ appearance: "system", uiLanguage: "en", advanced: false, launchSetupDone: true, voiceSetup: "no" }),
      // An hour old, so it's kept (for Forget) but not picked back up in the bubble.
      "conversations.json": JSON.stringify([{ id: "bubble", n: 0, title: "", target: null, savedAt: Date.now() - 3_600_000, transcript: [{ role: "user", text: "hello" }, { role: "buddy", text: "Hi." }] }]),
    };
    const { markers, timedOut } = await runCopy("controls", { BUDDY_SETTINGS_AUDIT_TEST: out }, "SETTINGS_AUDIT_DONE", 150_000, seed);
    const r = markers.SETTINGS_AUDIT?.[0];
    if (!r) return [timedOut ? "timed out" : "nothing printed"];
    return [...r.problems.map((p) => `${p.step}: ${p.problem}`), r.passed < 30 && `only ${r.passed} steps passed`].filter(Boolean);
  },

  // Buddy's windows in Spanish, and back to English live.
  async language() {
    const seed = { "settings.json": JSON.stringify({ uiLanguage: "es", launchSetupDone: true, voiceSetup: "no" }) };
    const { markers, timedOut } = await runCopy("language", { BUDDY_LANGUAGE_TEST: out }, "LANGUAGE_TEST_DONE", 90_000, seed);
    const r = markers.LANGUAGE_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "nothing printed"];
    const want = { spanish: { ask: "Preguntar", allow: "Permitir", placeholder: "¿Cómo hago…?  o  Hazlo por mí", lang: "es", talk: "Hablar" }, english: { ask: "Ask", allow: "Allow", placeholder: "How do I…?  or  Do it for me", lang: "en", talk: "Talk" } };
    return [
      ...["spanish", "english"].flatMap((which) => Object.entries(want[which]).filter(([k, v]) => r[which]?.[k] !== v).map(([k, v]) => `${which} ${k} was ${JSON.stringify(r[which]?.[k])}, not ${JSON.stringify(v)}`)),
      r.setupSpanish !== "Buddy necesita una IA para pensar. Elige una forma de empezar:" && `setup in Spanish said ${JSON.stringify(r.setupSpanish)}`,
      r.setupEnglish !== "Buddy needs an AI to think with. Pick one way in:" && `setup switched to English said ${JSON.stringify(r.setupEnglish)}`,
      ...(r.leftEnglish ?? ["Settings wasn't read"]).map((s) => `English left in Spanish Settings: ${s}`),
    ].filter(Boolean);
  },

  // A lesson played in a test-owned window, with no model: it follows the step to its result, says when a control
  // isn't there, and comes back the same from a shared file.
  async lessons() {
    const { markers, timedOut } = await runCopy("lessons", { BUDDY_LESSONS_TEST: path.join(app, "scripts", "samples", "context-window.ps1") }, "LESSONS_TEST_DONE", 120_000);
    const r = markers.LESSONS_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "nothing printed"];
    if (r.error) return [r.error];
    return [
      !r.waited && "the lesson never started waiting on its step",
      !r.clicked && "the check couldn't click the sample's control",
      !r.played?.done && `the lesson ended "${r.played?.text}", not done`,
      !/"Export to PDF" isn't on screen/.test(r.missing?.text ?? "") && `a missing control was told as ${JSON.stringify(r.missing?.text)}`,
      r.missing?.done && "a lesson with a missing control said it was done",
      !r.roundTrip && "a shared lesson didn't come back the same",
      !(r.listed ?? []).includes("Open the quarterly details") && `Settings listed ${JSON.stringify(r.listed)}`,
    ].filter(Boolean);
  },

  // Conversations surviving a restart: two runs on one data folder. The first answers a task and the bubble and quits
  // (closing every window); the second finds the task back as a chip, shows it, carries it into a follow-up, and
  // forgets it when it's closed.
  async restore() {
    const model = await echoModel();
    try {
      const seed = { "settings.json": JSON.stringify({ provider: "custom", providerURLs: { custom: model.url }, providerModels: { custom: "scripted" }, advanced: true, launchSetupDone: true, voiceSetup: "no" }) };
      const first = await runCopy("restore-1", { BUDDY_RESTORE_TEST: "first" }, "RESTORE_TEST_DONE", 90_000, seed);
      const a = first.markers.RESTORE_FIRST?.[0];
      if (!a) return [first.timedOut ? "the first run timed out" : "the first run printed nothing"];
      const second = await runCopy("restore-2", { BUDDY_RESTORE_TEST: "second" }, "RESTORE_TEST_DONE", 90_000, {}, first.data);
      const b = second.markers.RESTORE_SECOND?.[0];
      if (!b) return [second.timedOut ? "the second run timed out" : "the second run printed nothing"];
      const followUp = model.requests.find((r) => r.includes("And undo that?")) ?? "";
      return [
        !/Where is Save As/.test(a.bubbleReply ?? "") && `the bubble answered ${JSON.stringify(a.bubbleReply)}`,
        !(a.kept.includes("t1") && a.kept.includes("bubble")) && `quitting kept ${JSON.stringify(a.kept)}, not the task and the bubble`,
        (b.listed.length !== 1 || b.listed[0].id !== "t1" || b.listed[0].title !== "Sort the budget") && `after the restart the island listed ${JSON.stringify(b.listed)}`,
        b.windowsBeforeOpen && "the restored task opened a window before it was asked to",
        !/How do I sort column B\?[\s\S]*Answer to: How do I sort column B\?/.test(b.shown ?? "") && `the task window showed ${JSON.stringify(b.shown)}`,
        !/before Buddy restarted/.test(followUp) && "the follow-up didn't carry the earlier conversation",
        !/How do I sort column B\?/.test(followUp) && "the follow-up didn't include the earlier question",
        !(b.bubble ?? []).some((l) => /Where is Save As/.test(l.text)) && `the bubble's conversation didn't come back: ${JSON.stringify(b.bubble)}`,
        !b.keptAfterAsk?.includes("t1") && "the task wasn't kept after its follow-up",
        b.keptAfterClose?.includes("t1") && "closing the task didn't forget it",
      ].filter(Boolean);
    } finally {
      model.close();
    }
  },

  // An AI app's calls over the pipe, as buddy-mcp makes them: answered with the right token, refused without it. The
  // copy serves on a pipe of its own, so a running Buddy's AI apps never reach it.
  async bridge() {
    const pipe = `\\\\.\\pipe\\desktop-buddy-e2e-${process.pid}`;
    const { markers, timedOut } = await runCopy("bridge", { BUDDY_BRIDGE_TEST: "1", BUDDY_PIPE: pipe }, "BRIDGE_TEST_DONE");
    const r = markers.BRIDGE_TEST?.[0];
    if (!r) return [timedOut ? "timed out" : "nothing printed"];
    return [
      r.hello !== "ok" && `hello answered ${JSON.stringify(r.hello)}`,
      !/\S/.test(r.windows) || /couldn't|Unknown tool/i.test(r.windows) ? `list_windows answered ${JSON.stringify(r.windows)}` : null,
      !/hasn't marked anything/.test(r.marks) && `get_marks answered ${JSON.stringify(r.marks)}`,
      r.refusedReplies !== 0 && `a wrong token got ${r.refusedReplies} answer(s)`,
    ].filter(Boolean);
  },

  mark: {
    interactive: true,
    async run() {
      const shot = path.join(out, "marks.png");
      const strokes = JSON.stringify([[{ x: 200, y: 200 }, { x: 320, y: 220 }, { x: 420, y: 210 }]]);
      // Marking needs an AI set up (without one, Buddy opens the bubble to ask for a key); no call is made.
      const { markers, timedOut } = await runCopy("mark", { BUDDY_MARK_TEST: strokes, BUDDY_MARK_TEST_OUT: shot, ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "MARK_TEST_DONE");
      if (!markers.MARKS) return [timedOut ? "timed out" : "no marks printed"];
      return [markers.MARKS[0].length !== 1 && `expected 1 mark, got ${markers.MARKS[0].length}`, !fs.existsSync(shot) && "no marks image"].filter(Boolean);
    },
  },

  approval: {
    interactive: true,
    async run() {
      const problems = [];
      for (const kind of ["plain", "guide", "cycle", "twoasks"]) {
        const { markers, timedOut } = await runCopy(`approval-${kind}`, { BUDDY_APPROVAL_TEST: kind, ANTHROPIC_API_KEY: "sk-ant-e2e-not-used-0000000000" }, "APPROVAL_TEST", 60_000);
        const r = markers.APPROVAL_TEST?.[0];
        if (!r) problems.push(`${kind}: ${timedOut ? "timed out" : "nothing printed"}`);
        else if (r.answered !== "allow") problems.push(`${kind}: the click on Allow didn't count (${r.answered})`);
        else if (!r.keyboardBackInApp) problems.push(`${kind}: the keyboard didn't go back to the app after the click`);
      }
      return problems;
    },
  },
};

// ---------- Run ----------

const args = process.argv.slice(2);
const exeAt = args.indexOf("--exe");
if (exeAt >= 0) args.splice(exeAt, 2);
const interactive = args.includes("--interactive");
const named = args.filter((a) => !a.startsWith("--"));
const chosen = Object.entries(CHECKS).filter(([name, c]) => (named.length ? named.includes(name) : typeof c === "function" || (interactive && c.interactive)) && !(noVoice && name === "voice"));
if (!chosen.length) {
  console.error(`No such check. Checks: ${Object.keys(CHECKS).join(", ")}`);
  process.exit(2);
}
console.log(`Buddy end-to-end · ${chosen.length} check(s) · screenshots and logs in ${path.relative(process.cwd(), out)}\n`);
let failed = 0;
for (const [name, c] of chosen) {
  const t0 = Date.now();
  let problems;
  try {
    problems = await (typeof c === "function" ? c() : c.run());
  } catch (err) {
    problems = [`crashed: ${err?.stack ?? err}`];
  }
  // A state change the tables refused during this check is a bug, even if what the check looked at came out right.
  problems.push(...refusals.splice(0).map((r) => `refused state change: ${r}`));
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"}  ${name.padEnd(10)} ${s.padStart(5)} s${problems.map((p) => `\n      ${p}`).join("")}`);
}
console.log(`\n${chosen.length - failed}/${chosen.length} passed`);
process.exit(failed ? 1 : 0);
