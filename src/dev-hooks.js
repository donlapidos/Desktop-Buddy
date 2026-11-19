// Dev and end-to-end hooks: each BUDDY_*_TEST variable runs one scripted check inside the real app (scripts/e2e.mjs
// starts test copies with them). main.js imports this file only when one of those variables is set, so a normal
// Buddy never loads it, and hands it what it needs as one kit (DevKit). Members main.js reassigns (settings, brain,
// about, the marker's state) are read through the kit each time; the rest are fixed once the app is ready.
import { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, nativeImage, nativeTheme, screen } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Brain, setBrainDefaults } from "./brain.js";
import { listWindows, observe, resolveBinary } from "./desktop.js";
import { asPhysicalRect } from "./geometry.js";
import { learnCaps } from "./providers.js";

/**
 * What main.js lends the hooks.
 * @typedef {{
 *   here: string,
 *   trace: (entry: object) => void,
 *   settings: any, brain: any, about: { window: any, point: any },
 *   markDisplay: Electron.Display | null, markWin: Electron.BrowserWindow | null, pendingMarks: any, displayCaptures: number,
 *   bubble: Electron.BrowserWindow, island: Electron.BrowserWindow, tasks: any, voice: any, updates: any, activity: any,
 *   settingsWindow: { open: (page?: string) => void },
 *   point: Function, guidePoint: Function, confirm: Function, summon: Function, toggle: Function, ownPids: () => number[],
 *   startMarking: Function, cancelMarking: Function, stopMarkMode: Function, enter: Function, currentMode: Function, grabDisplay: Function,
 *   toLocalRect: Function, annotationLayer: any, showAnnotations: Function, releaseLater: Function, openExplainer: Function,
 *   changeSettings: (patch: object) => any, settingsState: () => any, settingsFile: () => string, runRoutine: Function,
 *   typeText: (text: string) => Promise<void>, saveApiKey: Function, loadApiKey: Function, providerURL: Function,
 *   prepareScreenImage: Function, timingLog: () => string, documentsDir: () => string, startBrain: Function, spendState: Function,
 *   pressHotkey: (name: any) => void, sendVoiceOffer: () => void, startupVoiceFetch: () => void, useKeyHook: (hook: import("./hold-key.js").KeyHook) => void,
 *   connectors: ReturnType<typeof import("./connectors.js").createConnectors> | null, offerConnection: (win: any) => Promise<void>,
 *   lessons: ReturnType<typeof import("./lessons.js").createLessons> | null, playLesson: (id: string, opts?: { window?: any }) => Promise<any>,
 * }} DevKit
 */

/** Runs the hook whose variable is set. Writes "dev-hooks-loaded" to the timing log, so a check can see it never runs in a normal Buddy. @param {DevKit} kit */
export function runDevHook(kit) {
  kit.trace({ kind: "dev-hooks-loaded" });
  const name = Object.keys(HOOKS).find((n) => process.env[n]);
  if (name) HOOKS[name](kit);
}

/** BUDDY_POINT_TEST @param {DevKit} kit */
function pointTest(kit) {
  const { point } = kit;
  // Dev check for coordinate mapping: BUDDY_POINT_TEST='{"x":..,"y":..,"width":..,"height":..}' (physical px)
  setTimeout(() => point(JSON.parse(process.env.BUDDY_POINT_TEST), "Is this the right spot?"), 2500);
}

/** BUDDY_MARK_TEST @param {DevKit} kit */
function markTest(kit) {
  const { startMarking, bubble, island } = kit;
  // Dev check for the marker without a mouse: BUDDY_MARK_TEST='[[{"x":..,"y":..},...],...]' (screen DIP strokes).
  // BUDDY_MARK_TEST_OUT=path saves the image the model would receive.
  setTimeout(async () => {
    await startMarking();
    const strokes = JSON.parse(process.env.BUDDY_MARK_TEST).map((s) =>
      s.map((p) => ({ x: p.x - kit.markDisplay.bounds.x, y: p.y - kit.markDisplay.bounds.y })),
    );
    const ready = setInterval(() => {
      if (!kit.markWin?.isVisible()) return;
      clearInterval(ready);
      kit.markWin.webContents.send("mark-inject", strokes);
    }, 100);
    const done = setInterval(() => {
      if (!kit.pendingMarks) return;
      clearInterval(done);
      if (!process.env.BUDDY_MARK_TEST_OUT) return;
      fs.writeFileSync(process.env.BUDDY_MARK_TEST_OUT, Buffer.from(kit.pendingMarks.image, "base64"));
      console.log("MARKS", JSON.stringify(kit.pendingMarks.marks.map((x) => ({ n: x.n, elements: x.elements.map((e) => e.path) }))));
      setTimeout(async () => {
        const img = await bubble.webContents.capturePage();
        fs.writeFileSync(process.env.BUDDY_MARK_TEST_OUT.replace(/.png$/, "-bubble.png"), img.toPNG());
        console.log("BUBBLE_SHOT", JSON.stringify(bubble.getBounds()), JSON.stringify(island.getBounds()));
        console.log("MARK_TEST_DONE");
      }, 600);
    }, 100);
  }, 2500);
}

/** BUDDY_TASK_TEST @param {DevKit} kit */
function taskTest(kit) {
  const { island, tasks } = kit;
  // Dev check for task windows without the model: two scripted agents, one of which asks for approval.
  // BUDDY_TASK_TEST=<dir> saves each task window and the island there.
  const out = process.env.BUDDY_TASK_TEST;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const scripted = (steps, reply, approval) => ({
    ui: {},
    log: [],
    transcript() {
      return this.log.slice();
    },
    cancel() {},
    async ask(text) {
      this.log.push({ role: "user", text });
      for (const s of steps) {
        await wait(700);
        this.ui.status(s);
      }
      if (approval) this.ui.status((await this.ui.confirm(approval)) === "deny" ? "Skipped that." : approval);
      await wait(600);
      this.log.push({ role: "buddy", text: reply });
      return reply;
    },
  });
  setTimeout(async () => {
    await tasks.create({ brain: scripted(["Looking…", "Reading the page…", "Comparing the three plans"], "The Pro plan is the only one with SSO. It costs $24 a seat, and the annual price saves 20%.") });
    await tasks.create({ brain: scripted(["Looking…"], "Saved the file as report-final.xlsx.", "Click Save") });
    const taskWins = () => BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().endsWith("task.html"));
    for (let i = 0; i < 50 && taskWins().length < 2; i++) await wait(100);
    const wins = taskWins().sort((a, b) => a.id - b.id);
    const asks = ["Compare the pricing plans on this page", "Save this workbook"];
    await wait(800);
    wins.forEach((w, i) => w.webContents.executeJavaScript(`document.getElementById("input").value = ${JSON.stringify(asks[i])}; document.getElementById("form").requestSubmit();`));
    await wait(1800);
    wins[0].hide(); // tuck task 1 into the island while it works
    await wait(2600);
    const shot = async (name, win) => {
      win.webContents.invalidate(); // a transparent window can hand back its last frame otherwise
      await wait(150);
      fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
    };
    await shot("task-2-confirm.png", wins[1]);
    await shot("island.png", island);
    console.log("TASKS", JSON.stringify(tasks.list()));
    // Preview the tucked-away task from the island, then approve task 2 from its preview.
    await island.webContents.executeJavaScript(`showPeek("t1")`);
    await wait(1500);
    await shot("island-peek-hidden.png", island);
    await island.webContents.executeJavaScript(`showPeek("t2")`);
    await wait(1500);
    {
      // What's actually on screen, cropped to the island (a page capture of this transparent window can be stale).
      const d = screen.getPrimaryDisplay();
      const sf = d.scaleFactor;
      const [src] = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) } });
      const b = island.getBounds();
      fs.writeFileSync(path.join(out, "island-peek-confirm.png"), src.thumbnail.crop({ x: Math.round(b.x * sf), y: Math.round(b.y * sf), width: Math.round(b.width * sf), height: Math.round(b.height * sf) }).toPNG());
    }
    await island.webContents.executeJavaScript(`document.getElementById("peek-allow").click(); showPeek(null);`);
    await wait(2500);
    wins[0].show();
    await wait(400);
    await shot("task-1-done.png", wins[0]);
    await shot("task-2-done.png", wins[1]);
    console.log("TASKS", JSON.stringify(tasks.list()));
    console.log("TASK_TEST_DONE");
  }, 2500);
}

/** BUDDY_VOICE_TEST @param {DevKit} kit */
function voiceTest(kit) {
  const { voice } = kit;
  // Dev check for the speech engine, muted: the voice says a line, the recognizer hears it back, then a two-sentence reply
  // plays through the voice page. BUDDY_VOICE_TEST_MIC=1 also opens the microphone once.
  setTimeout(async () => {
    voice.mute();
    await voice.warm();
    const line = process.env.BUDDY_VOICE_TEST;
    let t0 = Date.now();
    const clip = await voice.synthesize(line);
    console.log("VOICE_SYNTH", Date.now() - t0, "ms", (clip.audio.length / clip.rate).toFixed(2), "s");
    const ratio = clip.rate / 16000;
    const pcm = Float32Array.from({ length: Math.floor(clip.audio.length / ratio) }, (_, i) => clip.audio[Math.floor(i * ratio)]);
    t0 = Date.now();
    const { text } = await voice.transcribe(pcm);
    console.log("VOICE_HEARD", Date.now() - t0, "ms", JSON.stringify(text));
    t0 = Date.now();
    await voice.say(`**${line}** It's under the *Formulas* tab → Insert Function.`);
    console.log("VOICE_SAID", Date.now() - t0, "ms");
    if (process.env.BUDDY_VOICE_TEST_MIC) console.log("VOICE_MIC", JSON.stringify(await voice.listen()));
    console.log("VOICE_HOLD", JSON.stringify(await holdToTalkCheck(kit)));
    console.log("VOICE_TEST_DONE");
  }, 1500);
}

// Hold to talk through the real shortcut handling, with a stand-in for the keyboard hook and for the microphone (the
// check never opens the mic): a hold keeps listening through pauses and its release ends it; a tap only starts
// listening; a release that never comes times out (BUDDY_HOLD_TIMEOUT_MS) and stops listening. The hook must be
// installed only while the key is down.
/** @param {DevKit} kit */
async function holdToTalkCheck(kit) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = 20; // uiohook's code for T, the key of the default Talk shortcut (Control+Alt+T)
  const hook = { installed: false, onKeyUp: null, start(cb) { this.installed = true; this.onKeyUp = cb; }, stop() { this.installed = false; this.onKeyUp = null; } };
  kit.useKeyHook(hook);
  /** @type {string[]} */
  let calls = [];
  let finishListen = null;
  const voice = kit.voice;
  voice.listen = () => { calls.push("listen"); return new Promise((r) => { finishListen = r; }); };
  voice.holdListening = () => calls.push("hold");
  voice.finishListening = () => { calls.push("finish"); finishListen?.({ error: "cancelled" }); finishListen = null; };
  voice.cancelListening = () => { calls.push("cancel"); finishListen?.({ error: "cancelled" }); finishListen = null; };
  Object.defineProperty(voice, "listening", { get: () => !!finishListen, configurable: true });
  const idle = async () => { for (let i = 0; i < 50 && kit.currentMode() !== "idle"; i++) await wait(100); return kit.currentMode() === "idle"; };
  const r = { idleBefore: !hook.installed };
  // Held until listening has started and a moment more, then let go. (A fixed second wasn't enough on a busy PC:
  // listening began after the release, and Buddy rightly ended it at once.)
  kit.pressHotkey("talk");
  await wait(150);
  r.installedWhileDown = hook.installed;
  for (let i = 0; i < 50 && !calls.includes("listen"); i++) await wait(100);
  await wait(500);
  hook.onKeyUp?.(T);
  await wait(300);
  r.held = calls.join(",");
  r.idleAfterHold = !hook.installed && (await idle());
  // A tap: listening starts as before (until a pause), and nothing holds it open.
  calls = [];
  kit.pressHotkey("talk");
  await wait(100);
  hook.onKeyUp?.(T);
  await wait(600);
  r.tapped = calls.join(",");
  r.hookGoneAfterTap = !hook.installed;
  voice.cancelListening();
  await idle();
  // Held, and the release never arrives.
  calls = [];
  kit.pressHotkey("talk");
  await wait(Number(process.env.BUDDY_HOLD_TIMEOUT_MS ?? 2000) + 800);
  r.timedOut = calls.join(",");
  r.idleAfterTimeout = !hook.installed && (await idle());
  return r;
}

/** BUDDY_APPROVAL_TEST @param {DevKit} kit */
function approvalTest(kit) {
  const { here, guidePoint, confirm, summon, toggle, ownPids, bubble } = kit;
  // Dev check, with a REAL mouse click (the pointer moves; keep hands off the mouse): an approval card must take a
  // click, and the keyboard must go back to the user's app afterwards. Cases:
  //   plain    the card in a bubble opened once
  //   guide    the bubble folds away while Buddy points at a step, then the card comes
  //   cycle    the bubble is closed and opened again before asking (this left cards deaf to clicks)
  //   twoasks  one answer guides, the bubble is opened again, and the next answer needs approval
  // Run: BUDDY_APPROVAL_TEST=cycle npm start (it needs ANTHROPIC_API_KEY set to anything; Claude isn't called).
  const kind = process.env.BUDDY_APPROVAL_TEST;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = asPhysicalRect({ x: 200, y: 300, width: 120, height: 40 });
  setTimeout(async () => {
    await summon();
    await wait(800);
    let answered = null;
    const approve = async () => {
      if (kind === "guide") {
        await guidePoint(step, "Click here");
        await wait(1500);
      }
      answered = await confirm('Create "Report" in Documents\\Buddy and open it in Word', null);
      return "Done.";
    };
    kit.brain = { reset() {}, cancel() {}, marks: new Map(), transcript: () => [], ask: approve };
    if (kind === "cycle") {
      toggle();
      await wait(800);
      toggle();
      await wait(1200);
    }
    if (kind === "twoasks") {
      kit.brain.ask = async () => {
        await guidePoint(step, "Click here");
        await wait(1500);
        kit.brain.ask = approve;
        return "Done guiding.";
      };
      await bubble.webContents.executeJavaScript(`window.buddy.ask("show me how", {})`);
      await wait(7500);
      toggle();
      await wait(1200);
    }
    bubble.webContents.executeJavaScript(`window.buddy.ask("make a report", {})`);
    await wait(4000);
    const box = await bubble.webContents.executeJavaScript(`(() => { const r = document.querySelector('#confirm [data-d="allow"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const b = bubble.getContentBounds();
    const at = screen.dipToScreenPoint({ x: Math.round(b.x + box.x), y: Math.round(b.y + box.y) });
    const { execFileSync } = await import("node:child_process");
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(here, "../scripts/real-click.ps1"), String(at.x), String(at.y)]);
    await wait(1500);
    const front = (await listWindows()).find((w) => w.is_focused);
    console.log("APPROVAL_TEST", JSON.stringify({ kind, answered, keyboardBackInApp: !!front && !ownPids().includes(front.pid) }));
    app.quit();
  }, 2500);
}

/** BUDDY_SETTINGS_TEST @param {DevKit} kit */
function settingsTest(kit) {
  const { ownPids, changeSettings, settingsState, settingsFile, settingsWindow, runRoutine, typeText, saveApiKey, loadApiKey, bubble, island, voice, updates } = kit;
  // Dev check for Settings: BUDDY_SETTINGS_TEST=<dir> captures each section of the window there, then checks that
  // changes reach the rest of Buddy (the island's colour, the registered shortcuts, the file) and that a clash is
  // refused.
  const out = process.env.BUDDY_SETTINGS_TEST;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  setTimeout(async () => {
    settingsWindow.open();
    await wait(1500);
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("settings.html"));
    const shoot = async (page, name) => {
      await win.webContents.executeJavaScript(`show(${JSON.stringify(page)})`);
      await wait(400);
      fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    };
    for (const page of ["voice", "look", "keys", "lessons", "claude"]) await shoot(page, `settings-${page}`);
    await win.webContents.executeJavaScript(`document.querySelector("main").scrollTop = 9999`);
    await wait(300);
    fs.writeFileSync(path.join(out, "settings-claude-bottom.png"), (await win.webContents.capturePage()).toPNG());
    const problems = changeSettings({ accent: "coral", voice: 3, speed: 1.15, hotkeys: { ask: "Control+Alt+K" } });
    await wait(800);
    const accentOf = (wc) => wc.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue("--buddy").trim()`);
    console.log("SETTINGS_APPLIED", JSON.stringify({
      problems,
      island: await accentOf(island.webContents),
      bubble: await accentOf(bubble.webContents),
      settingsPage: await accentOf(win.webContents),
      newAskHeld: globalShortcut.isRegistered("Control+Alt+K"),
      oldAskReleased: !globalShortcut.isRegistered("Control+Alt+B"),
      file: JSON.parse(fs.readFileSync(settingsFile(), "utf8")),
    }));
    console.log("SETTINGS_CLASH", JSON.stringify(changeSettings({ hotkeys: { talk: "Control+Alt+K" } })));
    // Agents: the policy reaches every Brain.
    changeSettings({ rope: "trusted", trustedApps: ["Notepad"] });
    const { decide } = await import("./policy.js");
    console.log("SETTINGS_POLICY", JSON.stringify({
      notepadType: decide(kit.settings, { kind: "type", app: "notepad.exe" }),
      wordType: decide(kit.settings, { kind: "type", app: "WINWORD.EXE" }),
      keepass: decide(kit.settings, { kind: "scroll_to", app: "KeePass.exe" }),
    }));
    // Folders read without asking: one Buddy may never read freely stays off the list, whoever asks, and the Agents
    // page shows what is on it.
    const projects = path.join(os.homedir(), "Projects");
    const folders = changeSettings({ advanced: true, readFolders: [projects, path.join(os.homedir(), "AppData")] });
    await wait(300);
    console.log("SETTINGS_FOLDERS", JSON.stringify({
      problem: folders.readFolders ?? null,
      list: kit.settings.readFolders,
      projects,
      chips: await win.webContents.executeJavaScript(`[...document.querySelectorAll("#folders .app-chip")].map((c) => c.title)`),
    }));
    await win.webContents.executeJavaScript(`show("agents"), document.getElementById("folders").scrollIntoView({ block: "center" })`);
    await wait(400);
    fs.writeFileSync(path.join(out, "settings-agents-folders.png"), (await win.webContents.capturePage()).toPNG());
    // Windows high contrast, emulated: the same page as someone using it sees it (switches, chips, focus).
    try {
      win.webContents.debugger.attach("1.3");
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
      await wait(400);
      fs.writeFileSync(path.join(out, "settings-agents-contrast.png"), (await win.webContents.capturePage()).toPNG());
      await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [] });
      win.webContents.debugger.detach();
    } catch (err) {
      console.log("SETTINGS_CONTRAST", JSON.stringify({ skipped: String(err) }));
    }
    changeSettings({ readFolders: null });
    // Routines: one saved, shown with its next run, and run now (no API key here, so it must say so, not call Claude).
    changeSettings({ routines: [{ id: "rtest1", name: "Inbox check", prompt: "Summarise my unread email.", schedule: { every: "weekday", time: "09:00", days: [], hours: 4 } }] });
    const started = await runRoutine(kit.settings.routines[0], "now");
    console.log("SETTINGS_ROUTINE", JSON.stringify({ info: settingsState().routineInfo.rtest1, started }));
    // Dictation types through the clipboard into the focused app, then puts the clipboard back. The target is a window
    // of Buddy's own, and the paste is skipped unless it really has the keyboard, so nothing lands in another app.
    // It replaces what the user had copied, so it runs only when asked (BUDDY_SETTINGS_TEST_DICTATION=1).
    if (process.env.BUDDY_SETTINGS_TEST_DICTATION) {
    const pad = new BrowserWindow({ width: 420, height: 160, show: false, title: "Buddy dictation check", webPreferences: { sandbox: true } });
    await pad.loadURL("data:text/html,<title>Buddy dictation check</title><textarea id=t autofocus style='width:100%;height:120px'></textarea>");
    pad.show();
    pad.focus();
    await pad.webContents.executeJavaScript("document.getElementById('t').focus()");
    await wait(500);
    await clipboard.writeText("what the user had copied");
    // Electron's isFocused() can say yes while Windows gives the keyboard to another app (a background app may not
    // take focus), so ask Windows which window really has it, through agent-desktop.
    const front = (await listWindows()).find((w) => w.is_focused);
    if (front && ownPids().includes(front.pid) && front.title === "Buddy dictation check") {
      await typeText("Hello from dictation.");
      await wait(400);
      console.log("SETTINGS_DICTATION", JSON.stringify({
        typed: await pad.webContents.executeJavaScript("document.getElementById('t').value"),
        clipboardRestored: (await clipboard.readText()) === "what the user had copied",
      }));
    } else console.log("SETTINGS_DICTATION", JSON.stringify({ skipped: "the test window didn't get the keyboard" }));
    pad.destroy();
    } else console.log("SETTINGS_DICTATION", JSON.stringify({ skipped: "not asked for (BUDDY_SETTINGS_TEST_DICTATION)" }));
    // Language: Spanish spoken by the voice, heard through Buddy's own speech process with detection on. Skipped where
    // the voice models aren't downloaded (BUDDY_E2E_NO_VOICE, set by `npm run e2e -- --no-voice` in CI).
    changeSettings({ language: "auto" });
    if (process.env.BUDDY_E2E_NO_VOICE) console.log("SETTINGS_LANGUAGE", JSON.stringify({ skipped: "no voice models" }));
    else {
      voice.mute();
      const clip = await voice.synthesize("Haz clic en la pestaña Fórmulas y luego elige Insertar función.", { lang: "es" });
      const ratio = clip.rate / 16000;
      const pcm = Float32Array.from({ length: Math.floor(clip.audio.length / ratio) }, (_, i) => clip.audio[Math.floor(i * ratio)]);
      const t0 = Date.now();
      console.log("SETTINGS_LANGUAGE", JSON.stringify({ ...(await voice.transcribe(pcm)), ms: Date.now() - t0 }));
    }
    // A key for "Other server" goes only to the address it was saved for.
    changeSettings({ provider: "custom", providerURLs: { custom: "https://a.example/v1" } });
    saveApiKey("key-for-server-a-0123456789", "custom");
    const atA = { key: settingsState().key, sent: loadApiKey() };
    changeSettings({ providerURLs: { custom: "https://b.example/v1" } });
    const atB = { key: settingsState().key, sent: loadApiKey() };
    changeSettings({ providerURLs: { custom: "https://a.example/v1" } });
    const backAtA = { key: settingsState().key, sent: loadApiKey() };
    console.log("SETTINGS_KEYS", JSON.stringify({ atA, atB, backAtA }));
    changeSettings({ provider: "anthropic" });
    for (const page of ["dictation", "agents", "routines"]) await shoot(page, `settings-${page}`);
    await updates.check();
    await wait(4000);
    await shoot("about", "settings-about");
    // Report a problem: the preview opens with the whole report to read. Nothing is sent: no send button is pressed.
    await win.webContents.executeJavaScript(`document.getElementById("report").click()`);
    let report = "";
    for (let i = 0; i < 50 && !report; i++) {
      await wait(100);
      report = await win.webContents.executeJavaScript(`document.getElementById("report-preview").hidden ? "" : document.getElementById("report-text").value`);
    }
    await win.webContents.executeJavaScript(`document.getElementById("report-text").scrollIntoView()`);
    await wait(300);
    fs.writeFileSync(path.join(out, "settings-report.png"), (await win.webContents.capturePage()).toPNG());
    console.log("SETTINGS_REPORT", JSON.stringify({ shown: !!report, version: report.includes(`Desktop Buddy ${app.getVersion()}`), timing: /"kind":/.test(report),
      key: report.includes("key-for-server-a-0123456789"), home: report.toLowerCase().includes(os.homedir().toLowerCase()), chars: report.length }));
    await win.webContents.executeJavaScript(`document.getElementById("report-cancel").click()`);
    console.log("SETTINGS_INSTALLED", JSON.stringify({ packaged: app.isPackaged, agentDesktop: resolveBinary(), userData: app.getPath("userData"), updates: updates.state() }));
    await win.webContents.executeJavaScript(`render(${JSON.stringify(settingsState())})`);
    await shoot("look", "settings-look-coral");
    await shoot("keys", "settings-keys-changed");
    console.log("SETTINGS_TEST_DONE");
  }, 2500);
}

/** BUDDY_EXPLAINER_TEST @param {DevKit} kit */
function explainerTest(kit) {
  const { openExplainer } = kit;
  // Dev check for the explainer renderer: BUDDY_EXPLAINER_TEST=path/to/explainer.json (show_explainer input)
  openExplainer(JSON.parse(fs.readFileSync(process.env.BUDDY_EXPLAINER_TEST, "utf8")));
  setTimeout(async () => {
    const plates = BrowserWindow.getAllWindows().filter((w) => /explainer/i.test(w.webContents.getURL()));
    const out = process.env.BUDDY_EXPLAINER_TEST_OUT;
    if (out && plates[0]) fs.writeFileSync(out, (await plates[0].webContents.capturePage()).toPNG());
    const text = plates[0] ? await plates[0].webContents.executeJavaScript("document.body.innerText") : "";
    // Settings › Look › Explainer appearance: what the plate shows, as it opened and after switching while it's open.
    const look = async () => plates[0]?.webContents.executeJavaScript(`({ dark: matchMedia("(prefers-color-scheme: dark)").matches, paper: getComputedStyle(document.documentElement).backgroundColor })`);
    const opened = await look();
    const other = kit.settings.appearance === "light" ? "dark" : "light";
    kit.changeSettings({ appearance: other });
    await new Promise((r) => setTimeout(r, 600));
    const switched = { to: other, ...(await look()) };
    console.log("EXPLAINER_SHOWN", JSON.stringify({ windows: plates.length, visible: plates.some((w) => w.isVisible()), chars: text.length, title: text.split("\n").find((l) => l.trim()) ?? "", appearance: kit.settings.appearance, opened, switched }));
    console.log("EXPLAINER_TEST_DONE");
  }, 4000);
}

/** BUDDY_MARK_STARTUP_TEST @param {DevKit} kit */
function markStartupTest(kit) {
  const { startMarking, cancelMarking, stopMarkMode, enter, currentMode, grabDisplay } = kit;
  setTimeout(async () => {
    const { runMarkerStartupTest } = await import("./marker-startup-test.js");
    await runMarkerStartupTest({ start: startMarking, cancel: cancelMarking,
      retire: (delay) => { stopMarkMode(delay); enter("idle"); }, window: () => kit.markWin, mode: currentMode,
      captureFrame: grabDisplay, activeCaptures: () => kit.displayCaptures });
  }, 2500);
}

/** BUDDY_MARK_RENDER_TEST @param {DevKit} kit */
function markRenderTest(kit) {
  const { here } = kit;
  setTimeout(async () => {
    const { runMarkerTest } = await import("./marker-test.js");
    await runMarkerTest({ here, out: process.env.BUDDY_MARK_RENDER_TEST });
  }, 2500);
}

/** BUDDY_ANNOTATIONS_TEST @param {DevKit} kit */
function annotationsTest(kit) {
  const { here, point, toLocalRect, annotationLayer, showAnnotations, releaseLater } = kit;
  setTimeout(async () => {
    const { runAnnotationTest } = await import("./annotation-test.js");
    await runAnnotationTest({ script: process.env.BUDDY_ANNOTATIONS_SAMPLE ?? path.join(here, "../scripts/samples/context-window.ps1"),
      out: process.env.BUDDY_ANNOTATIONS_TEST, showAnnotations, annotationLayer, toLocalRect, point, release: releaseLater });
  }, 2500);
}

/** BUDDY_SCREEN_CONTEXT_TEST @param {DevKit} kit */
function screenContextTest(kit) {
  const { here, changeSettings, settingsFile, settingsWindow, providerURL, prepareScreenImage, bubble } = kit;
  // Capture only this test-owned sample. The scripted server checks both image transport and the real tree.
  setTimeout(async () => {
    let sample;
    try {
      const title = "Buddy visual context sample";
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const script = process.env.BUDDY_SCREEN_CONTEXT_SAMPLE ?? path.join(here, "../scripts/samples/context-window.ps1");
      sample = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script], { windowsHide: false });
      let sampleErrors = "";
      sample.stderr.on("data", (chunk) => { sampleErrors += chunk.toString(); });
      let sampleOutput = "";
      sample.stdout.on("data", (chunk) => { sampleOutput += chunk.toString(); });
      await new Promise((resolve, reject) => { sample.once("spawn", resolve); sample.once("error", reject); });
      let target;
      for (let i = 0; i < 50; i++) {
        target = (await listWindows()).find((w) => w.title === title && Number(w.pid) === sample.pid);
        if (target) break;
        await wait(200);
      }
      if (!target) throw new Error(`The sample window wasn't found (exit ${sample.exitCode}). ${sampleErrors.slice(0, 1000)} ${sampleOutput.slice(0, 200)}`);
      changeSettings({ provider: "custom", providerURLs: { custom: process.env.BUDDY_SCREEN_CONTEXT_TEST }, providerModels: { custom: "vision-fixture" }, screenContext: true, talkBack: "never" });
      learnCaps(providerURL(), "vision-fixture", { tools: true, vision: true });
      kit.about = { window: target, point: null };
      const js = (code) => bubble.webContents.executeJavaScript(code);
      const first = await js(`window.buddy.ask("Which bar is higher?", {})`);
      const sentImage = kit.brain.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []).find((c) => c.type === "image");
      let largeImageBounded = false;
      if (sentImage) {
        const large = nativeImage.createFromBuffer(Buffer.from(sentImage.source.data, "base64")).resize({ width: 3200, height: 2400 });
        // Sent at a size no provider shrinks again (geometry.js modelPictureSize), and Buddy knows that size.
        const compressed = prepareScreenImage({ source: { data: large.toPNG().toString("base64") } });
        const size = nativeImage.createFromBuffer(Buffer.from(compressed.image.source.data, "base64")).getSize();
        largeImageBounded = size.width === 1024 && size.height === 768 && compressed.width === 1024 && compressed.height === 768 && compressed.image.source.media_type === "image/jpeg";
      }
      const sight = sentImage ? await pointBySight(kit, target, sentImage, js) : { error: "no screenshot was sent" };
      settingsWindow.open("claude");
      let settingsWin;
      for (let i = 0; i < 100; i++) {
        settingsWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("settings.html") && !w.webContents.isLoading());
        if (settingsWin && await settingsWin.webContents.executeJavaScript(`document.getElementById("screen-context")?.getAttribute("aria-checked") === "true"`)) break;
        await wait(100);
      }
      if (!settingsWin) throw new Error("Settings didn't open.");
      const settingWasOn = await settingsWin.webContents.executeJavaScript(`document.getElementById("screen-context").getAttribute("aria-checked") === "true"`);
      await settingsWin.webContents.executeJavaScript(`document.getElementById("screen-context").click()`);
      for (let i = 0; kit.settings.screenContext && i < 50; i++) await wait(50);
      let settingUIOff = false;
      for (let i = 0; i < 50; i++) {
        settingUIOff = await settingsWin.webContents.executeJavaScript(`document.getElementById("screen-context").getAttribute("aria-checked") === "false"`);
        if (settingUIOff) break;
        await wait(50);
      }
      if (process.env.BUDDY_SCREEN_CONTEXT_TEST_OUT) fs.writeFileSync(process.env.BUDDY_SCREEN_CONTEXT_TEST_OUT, (await settingsWin.webContents.capturePage()).toPNG());
      const second = await js(`window.buddy.ask("Read the chart title", {})`);
      const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
      console.log("SCREEN_CONTEXT_TEST", JSON.stringify({ first: first.reply, second: second.reply, settingWasOn, settingOff: !kit.settings.screenContext, settingUIOff, savedOff: saved.screenContext === false, largeImageBounded, sight }));
    } catch (err) {
      console.log("SCREEN_CONTEXT_TEST", JSON.stringify({ error: err.message }));
    } finally {
      sample?.kill();
      console.log("SCREEN_CONTEXT_TEST_DONE");
    }
  }, 2500);
}

// Pointing by sight: the sample's chart bars have no control to point at. Playing the model's part, this finds the
// blue bar by its colour in the picture Buddy sent, asks Buddy to point there by a spot on it (the scripted server
// echoes the spot back as point_at), and checks that the pointer lands inside the bar as the window's own layout has
// it, shown as a best guess, and that it's let go again.
/** @param {DevKit} kit @param {any} target @param {any} sentImage @param {(code: string) => Promise<any>} js */
async function pointBySight(kit, target, sentImage, js) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const picture = nativeImage.createFromBuffer(Buffer.from(sentImage.source.data, "base64"));
  const { width, height } = picture.getSize();
  const px = picture.toBitmap(); // BGRA
  let box = null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (Math.abs(px[i + 2] - 0x2f) < 40 && Math.abs(px[i + 1] - 0x7a) < 40 && px[i] > 215) {
      box ??= { x0: x, y0: y, x1: x, y1: y };
      box = { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) };
    }
  }
  if (!box) return { error: "the blue bar isn't in the picture Buddy sent" };
  // Pixels on the picture as sent, as a model counts them.
  const spot = { x: Math.round((box.x0 + box.x1) / 2), y: Math.round((box.y0 + box.y1) / 2) };
  // Where the bar really is on screen, from the window's own layout (the bars are unnamed groups a look leaves out).
  const layout = await observe(["snapshot", "--window-id", target.id, "--include-bounds", "--max-depth", "30"], { timeoutMs: 10_000 });
  const bars = [];
  const walk = (n) => { if (n.role === "group" && n.name === "Quarterly sales" && n.bounds) bars.push(n.bounds); (n.children ?? []).forEach(walk); };
  if (layout.ok) walk(layout.data.tree);
  const bar = bars.sort((a, b) => b.height - a.height)[0];
  if (!bar) return { error: "the sample's bars weren't in its layout" };
  const ui = kit.brain.ui;
  const original = ui.pointGuess;
  /** @type {any} */
  let guessed = null;
  // What the overlay showing the pointer has on screen: a soft ring, and the caption it shows.
  const onScreen = async () => {
    for (const w of BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().endsWith("overlay.html"))) {
      const seen = await w.webContents.executeJavaScript(`(() => { const r = document.getElementById("ring"); return r.classList.contains("on") ? { soft: r.classList.contains("guess"), caption: document.getElementById("caption").textContent } : null; })()`);
      if (seen) return seen;
    }
    return { soft: false, caption: "" };
  };
  ui.pointGuess = async (bounds, caption, window) => {
    const shown = await original(bounds, caption, window);
    guessed = { bounds, ...(await onScreen()) };
    return shown;
  };
  try {
    const reply = (await js(`window.buddy.ask("Point at the blue bar [spot ${spot.x},${spot.y}]", {})`)).reply;
    if (!guessed) return { error: `Buddy didn't point by sight: ${reply}` };
    const c = { x: guessed.bounds.x + guessed.bounds.width / 2, y: guessed.bounds.y + guessed.bounds.height / 2 };
    const inside = c.x >= bar.x && c.x <= bar.x + bar.width && c.y >= bar.y && c.y <= bar.y + bar.height;
    // Let go within GUESS_MS (main.js), whether its window changed, the time ran out, or the answer let go of it.
    let cleared = false;
    for (let i = 0; i < 70 && !cleared; i++) {
      await wait(200);
      cleared = !(await onScreen()).soft;
    }
    return { reply, spot, bar, pointedAt: c, inside, softRing: guessed.soft, caption: guessed.caption, cleared };
  } finally {
    ui.pointGuess = original;
  }
}

/** BUDDY_CONVERSATION_TEST @param {DevKit} kit */
function conversationTest(kit) {
  const { summon, changeSettings, timingLog, bubble } = kit;
  // Real renderer + IPC + streamed model: show a partial answer, then steer it while it is still running.
  setTimeout(async () => {
    let sample;
    const js = (code) => bubble.webContents.executeJavaScript(code);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (code) => {
      for (const end = Date.now() + 10_000; Date.now() < end; await wait(50)) if (await js(code)) return true;
      return false;
    };
    try {
      changeSettings({ provider: "ollama", providerURLs: { ollama: process.env.BUDDY_CONVERSATION_TEST }, providerModels: { ollama: "scripted" }, talkBack: "never" });
      await summon();
      await js(`document.getElementById("input").value = "Start answering"; document.getElementById("form").requestSubmit();`);
      const partial = await until(`document.getElementById("reply").textContent === "The first sentence is visible. " && !document.getElementById("stop").hidden`);
      const editable = await js(`!document.getElementById("input").disabled`);
      if (process.env.BUDDY_CONVERSATION_TEST_OUT) fs.writeFileSync(process.env.BUDDY_CONVERSATION_TEST_OUT, (await bubble.webContents.capturePage()).toPNG());
      await js(`document.getElementById("input").value = "Change direction"; document.getElementById("form").requestSubmit();`);
      const corrected = await until(`document.getElementById("reply").textContent === "Here is the corrected answer." && document.getElementById("stop").hidden`);
      // A guided answer, in a test-owned sample window: it must leave one ask-to-pointer entry in the timing log.
      let guided = null;
      let firstPointer = null;
      let glanceReused = false;
      if (process.env.BUDDY_CONVERSATION_SAMPLE) {
        sample = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", process.env.BUDDY_CONVERSATION_SAMPLE], { windowsHide: false });
        let target;
        for (let i = 0; i < 50 && !target; i++) {
          target = (await listWindows()).find((w) => w.title === "Buddy visual context sample" && Number(w.pid) === sample.pid);
          if (!target) await wait(200);
        }
        if (!target) throw new Error("The sample window wasn't found.");
        kit.about = { window: target, point: null };
        // As when the bubble opens on their window and they type for a few seconds: the glance is the first read.
        kit.brain.glance(target);
        await wait(3000);
        guided = (await js(`window.buddy.ask("Where are the details?", {})`)).reply;
        const log = fs.readFileSync(timingLog(), "utf8").split(/\r?\n/);
        const lines = log.filter((l) => l.includes('"kind":"first-pointer"'));
        firstPointer = lines.length ? JSON.parse(lines.at(-1)) : null;
        glanceReused = JSON.parse(log.filter((l) => l.includes('"kind":"screen-context"')).at(-1) ?? "{}").reused === true;
      }
      console.log("CONVERSATION_TEST", JSON.stringify({ partial, editable, corrected, guided, firstPointer, glanceReused }));
    } catch (err) {
      console.log("CONVERSATION_TEST", JSON.stringify({ error: err.message }));
    } finally {
      sample?.kill();
    }
    console.log("CONVERSATION_TEST_DONE");
  }, 2500);
}

/** BUDDY_FILES_TEST @param {DevKit} kit */
function filesTest(kit) {
  const { changeSettings, settingsWindow, documentsDir, startBrain, bubble, island, activity } = kit;
  // End-to-end check of Buddy working with files, through the real app: BUDDY_FILES_TEST=<address of a scripted
  // OpenAI-style server> (scripts/e2e.mjs runs one). The model asks to make a file; the approval card is clicked;
  // the file is made, shown, listed in Activity, and undone. Files go to BUDDY_DOCUMENTS_DIR.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  setTimeout(async () => {
    // Files are an advanced feature: a new profile starts without them (Settings › Agents › Show advanced features).
    changeSettings({ advanced: true, provider: "custom", providerURLs: { custom: process.env.BUDDY_FILES_TEST }, providerModels: { custom: "scripted" } });
    setBrainDefaults(kit.settings);
    startBrain();
    await wait(500);
    const answer = bubble.webContents.executeJavaScript(`window.buddy.ask("Make me a shopping list file with eggs, milk and bread.", {})`);
    let carded = false;
    for (let i = 0; i < 100 && !carded; i++) {
      await wait(100);
      carded = await bubble.webContents.executeJavaScript(`document.getElementById("confirm").classList.contains("on")`);
    }
    const card = carded ? await bubble.webContents.executeJavaScript(`document.getElementById("what").textContent`) : null;
    await wait(700);
    // Another Buddy window (here the island) can't answer the bubble's card, though it has the same preload.
    island.webContents.executeJavaScript(`window.buddy.confirmReply("allow")`);
    await wait(400);
    const otherWindowRefused = await bubble.webContents.executeJavaScript(`document.getElementById("confirm").classList.contains("on")`);
    if (carded) await bubble.webContents.executeJavaScript(`document.querySelector('#confirm [data-d="allow"]').click()`);
    const { reply } = await answer;
    const file = path.join(documentsDir(), "Shopping list.txt");
    const made = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const listed = activity?.list() ?? [];
    settingsWindow.open("activity");
    await wait(1800);
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("settings.html"));
    const page = win ? await win.webContents.executeJavaScript(`document.getElementById("page-activity").hidden ? null : document.getElementById("activity").innerText`) : null;
    if (win && process.env.BUDDY_FILES_TEST_OUT) fs.writeFileSync(process.env.BUDDY_FILES_TEST_OUT, (await win.webContents.capturePage()).toPNG());
    const undone = listed[0] ? await activity?.undo(listed[0].id) : null;
    console.log("FILES_TEST", JSON.stringify({ card, otherWindowRefused, reply, made, listed: listed.map((e) => ({ kind: e.kind, summary: e.summary, canUndo: e.canUndo })), page, undone, goneAfterUndo: !fs.existsSync(file) }));
    console.log("FILES_TEST_DONE");
  }, 2500);
}

/** BUDDY_WELCOME_TEST @param {DevKit} kit */
function welcomeTest(kit) {
  const { summon, changeSettings, spendState, bubble } = kit;
  // End-to-end check of first-run setup, through the real bubble: BUDDY_WELCOME_TEST=<address of a scripted
  // Ollama-style server> (scripts/e2e.mjs runs one, and gives a made-up home in BUDDY_APPS_HOME holding a Gemini CLI
  // folder). Walks each way in: add Buddy to the AI app, a bad key and then a good one, and the model on "this PC".
  const out = process.env.BUDDY_WELCOME_TEST_OUT ?? app.getPath("userData");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (/** @type {string} */ code) => bubble.webContents.executeJavaScript(code);
  const until = async (/** @type {string} */ code, ms = 10_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await js(code)) return true;
    return false;
  };
  const shot = async (/** @type {string} */ name) => fs.writeFileSync(path.join(out, `welcome-${name}.png`), (await bubble.webContents.capturePage()).toPNG());
  const click = (/** @type {string} */ selector, text = "") => js(`[...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.includes(${JSON.stringify(text)})).click()`);
  const openDoors = async () => {
    await summon();
    await until(`document.querySelectorAll("[data-door]").length === 3`);
    await wait(400);
  };
  setTimeout(async () => {
    const r = {};
    // The voice models stand in as not yet on this PC, and the offered download is a stand-in too (no 275 MB here).
    let voiceThere = false;
    let fetches = 0;
    r.voiceSetupAtStart = kit.settings.voiceSetup;
    kit.voice.installed = () => voiceThere;
    kit.voice.prepare = async () => {
      fetches++;
      await wait(300);
      voiceThere = true;
    };
    changeSettings({ providerURLs: { ollama: process.env.BUDDY_WELCOME_TEST } });
    await openDoors();
    r.doors = await js(`[...document.querySelectorAll("[data-door]")].map((b) => b.dataset.door)`);
    r.keyFieldAtStart = await js(`!document.getElementById("form").hidden`);
    await shot("doors");

    await click("[data-door]", "AI app I already have");
    await until(`document.querySelectorAll("#welcome .app").length > 0`);
    r.apps = await js(`[...document.querySelectorAll("#welcome .app > span:first-child")].map((s) => s.textContent)`);
    await click("#welcome .app button", "Add Buddy");
    await until(`document.getElementById("welcome").innerText.startsWith("Buddy is in")`);
    r.appText = await js(`document.getElementById("welcome").innerText`);
    try {
      r.appEntry = JSON.parse(fs.readFileSync(path.join(process.env.BUDDY_APPS_HOME ?? "", ".gemini", "settings.json"), "utf8")).mcpServers?.["desktop-buddy"] ?? null;
    } catch {
      r.appEntry = null;
    }
    await shot("app-added");

    await click("#welcome button", "Back");
    await until(`document.querySelectorAll("[data-door]").length === 3`);
    await click("[data-door]", "API key");
    await js(`document.getElementById("input").value = "not a key"; document.getElementById("form").requestSubmit()`);
    await until(`!!document.querySelector("#welcome .problem")?.textContent`);
    r.badKey = await js(`document.querySelector("#welcome .problem").textContent`);
    // Said where it can be read: not squeezed to nothing, and inside the bubble.
    r.badKeyShown = await js(`(() => { const p = document.querySelector("#welcome .problem").getBoundingClientRect(), box = document.getElementById("welcome").getBoundingClientRect(); return p.height > 12 && p.top >= box.top && p.bottom <= box.bottom + 1; })()`);
    await shot("bad-key");

    await click("#welcome button", "Back");
    await until(`document.querySelectorAll("[data-door]").length === 3`);
    await click("[data-door]", "Free, on this PC");
    await until(`[...document.querySelectorAll("#welcome button")].some((b) => b.textContent === "Use Ollama")`);
    r.localText = await js(`document.getElementById("welcome").innerText`);
    await click("#welcome button", "Use Ollama");
    await until(`document.getElementById("welcome").hidden`, 20_000);
    r.localReady = { brain: !!kit.brain, provider: kit.settings.provider, shown: await js(`document.getElementById("reply").textContent`) };
    // The tour: a tip to ask about the window in front, then, once answered, one for Mark; "Got it" ends it.
    const tipNow = () => js(`document.getElementById("tip").hidden ? null : document.getElementById("tip").innerText`);
    await shot("local-ready");
    // The voice offer, once setup is done: "Not now" leaves the models alone; "Set up talking" fetches them.
    const offerNow = () => js(`document.getElementById("voice-offer").hidden ? null : document.getElementById("voice-offer-text").textContent`);
    await until(`!document.getElementById("voice-offer").hidden`, 3_000);
    r.voiceOffer = await offerNow();
    await shot("voice-offer");
    await js(`document.getElementById("voice-no").click()`);
    await until(`document.getElementById("voice-offer").hidden`, 3_000);
    r.voiceDeclined = { hidden: (await offerNow()) === null, setting: kit.settings.voiceSetup, fetches };
    // One at a time: the tour's first tip comes once the voice offer is answered.
    r.tipAfterSetup = await tipNow();
    await shot("tour-ask");
    // "Show me" on that tip: Buddy's first look at their window, asked with the note that makes it a show (the
    // scripted model counts it), and the tour moves on to Mark as after any first answer.
    r.showMeButton = await js(`(() => { const b = document.getElementById("tip-show"); return b.hidden ? null : b.textContent; })()`);
    await js(`document.getElementById("tip-show").click()`);
    await until(`document.getElementById("reply").textContent === "Hello from a model on this PC."`, 10_000);
    r.showMeReply = await js(`document.getElementById("reply").textContent`);
    await until(`/draw around/.test(document.getElementById("tip").innerText) && !document.getElementById("tip").hidden`, 3_000);
    r.showMeTip = await tipNow();
    changeSettings({ voiceSetup: "ask" });
    kit.sendVoiceOffer();
    await until(`!document.getElementById("voice-offer").hidden`, 3_000);
    await js(`document.getElementById("voice-yes").click()`);
    await until(`/Talking is ready/.test(document.getElementById("voice-offer-text").textContent)`, 5_000);
    // On a fast PC the start-up fetch (4 s after start) comes after the yes, as it did on CI: it mustn't fetch again.
    kit.startupVoiceFetch();
    r.voiceAccepted = { text: await offerNow(), setting: kit.settings.voiceSetup, fetches, buttons: await js(`document.getElementById("voice-yes").hidden && document.getElementById("voice-no").hidden`) };
    await shot("voice-ready");
    const answered = await js(`window.buddy.ask("Say hello.", {})`);
    r.localReply = answered.reply;
    r.localSpend = answered.spend;
    r.spendSettings = spendState();
    await until(`/draw around/.test(document.getElementById("tip").innerText) && !document.getElementById("tip").hidden`, 3_000);
    r.tipAfterAnswer = await tipNow();
    await shot("tour-mark");
    await js(`document.getElementById("tip-do").click()`);
    await until(`document.getElementById("tip").hidden`, 3_000);
    r.tipAfterGotIt = await tipNow();
    r.tourStep = kit.settings.tour;

    changeSettings({ provider: "anthropic" });
    await openDoors();
    r.doorsAgain = !kit.brain && (await js(`document.querySelectorAll("[data-door]").length`)) === 3;
    await click("[data-door]", "API key");
    await js(`document.getElementById("input").value = "sk-ant-api03-${"e2e".repeat(30)}"; document.getElementById("form").requestSubmit()`);
    await until(`document.getElementById("welcome").hidden`);
    r.keyReady = { brain: !!kit.brain, provider: kit.settings.provider, shown: await js(`document.getElementById("reply").textContent`) };
    r.tipAfterSecondSetup = await tipNow();
    await shot("key-ready");
    console.log("WELCOME_TEST", JSON.stringify(r));
    console.log("WELCOME_TEST_DONE");
  }, 2500);
}

/** BUDDY_ISLAND_TEST=<png path>: what this profile's island, bubble and Settings offer, and a picture of the island. @param {DevKit} kit */
function islandTest(kit) {
  const { island, bubble, summon, settingsWindow } = kit;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shown = (wc, selector) => wc.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return !!e && getComputedStyle(e).display !== "none"; })()`);
  setTimeout(async () => {
    const r = {};
    try {
      r.advanced = kit.settings.advanced;
      // The actions show when the pointer is over the island; open it as hovering would.
      await island.webContents.executeJavaScript(`document.getElementById("pill").classList.add("open")`);
      await wait(600);
      r.actions = [];
      for (const id of ["ask", "talk", "mark", "task"]) if (await shown(island.webContents, `#${id}`)) r.actions.push(id);
      island.webContents.invalidate();
      await wait(150);
      fs.writeFileSync(process.env.BUDDY_ISLAND_TEST ?? "", (await island.webContents.capturePage()).toPNG());
      await summon();
      await wait(800);
      r.makeTask = await shown(bubble.webContents, "#totask");
      // Its close button folds the chat back up into the island, which stays.
      r.closeShown = await shown(bubble.webContents, "#close");
      await bubble.webContents.executeJavaScript(`document.getElementById("close").click()`);
      for (let i = 0; i < 30 && bubble.isVisible(); i++) await wait(100);
      r.closed = !bubble.isVisible() && island.isVisible();
      settingsWindow.open();
      let win;
      for (let i = 0; i < 50 && !win; i++) {
        await wait(100);
        win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("settings.html") && !w.webContents.isLoading());
      }
      if (!win) throw new Error("Settings didn't open.");
      await wait(500);
      r.routines = await shown(win.webContents, '[data-page="routines"]');
    } catch (err) {
      r.error = err.message;
    }
    console.log("ISLAND_TEST", JSON.stringify(r));
    console.log("ISLAND_TEST_DONE");
  }, 2500);
}

/** BUDDY_BRIDGE_TEST */
function bridgeTest() {
  // An AI app's calls, end to end: over the pipe named in bridge.json, with its token, to a session's Brain, the way
  // buddy-mcp (mcp-server.js) makes them. A wrong token gets no answer at all.
  /** Sends `messages` on one connection; resolves the replies that came back before it closed. */
  const talk = (/** @type {string} */ pipe, /** @type {object[]} */ messages) =>
    new Promise((resolve) => {
      const replies = [];
      let buf = "";
      const socket = net.connect(pipe);
      const timer = setTimeout(() => socket.destroy(), 20_000);
      socket.setEncoding("utf8");
      socket.on("connect", () => messages.forEach((m) => socket.write(`${JSON.stringify(m)}\n`)));
      socket.on("data", (chunk) => {
        buf += chunk;
        for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
          replies.push(JSON.parse(buf.slice(0, nl)));
          buf = buf.slice(nl + 1);
          if (replies.length === messages.length) socket.end();
        }
      });
      socket.on("error", () => {});
      socket.on("close", () => (clearTimeout(timer), resolve(replies)));
    });
  setTimeout(async () => {
    const { pipe, token } = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "bridge.json"), "utf8"));
    const replies = await talk(pipe, [
      { id: 1, method: "hello", token, client: "E2E" },
      { id: 2, method: "tool", name: "list_windows", input: {} },
      { id: 3, method: "tool", name: "get_marks", input: {} },
    ]);
    const refused = await talk(pipe, [{ id: 1, method: "hello", token: "not-the-token" }, { id: 2, method: "tool", name: "list_windows", input: {} }]);
    const text = (r) => (typeof r?.result === "string" ? r.result : JSON.stringify(r?.result ?? null)).slice(0, 300);
    console.log("BRIDGE_TEST", JSON.stringify({ hello: replies[0]?.result ?? null, windows: text(replies[1]), marks: text(replies[2]), refusedReplies: refused.length }));
    console.log("BRIDGE_TEST_DONE");
  }, 2500);
}

/** BUDDY_RESTORE_TEST=first|second @param {DevKit} kit */
function restoreTest(kit) {
  // Conversations surviving a restart, in two runs on one data folder against a scripted model (scripts/e2e.mjs).
  // first: a task and the bubble each get an answer, then Buddy quits the way the tray's Quit does, closing every
  // window. second: the task is back as a chip, its window shows the conversation, a follow-up carries it, and
  // closing the task forgets it.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const kept = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "conversations.json"), "utf8")).map((c) => c.id);
    } catch {
      return [];
    }
  };
  const taskWindow = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("task.html"));
  // The scripted model answers "Answer to: <the question>", so a task's line says which question it has answered.
  const answered = async (question) => {
    for (let i = 0; i < 150 && !(kit.tasks.list()[0]?.line ?? "").includes(question); i++) await wait(100);
  };
  setTimeout(async () => {
    const { tasks, bubble } = kit;
    if (process.env.BUDDY_RESTORE_TEST === "first") {
      await tasks.create({ title: "Sort the budget", target: null, prompt: "How do I sort column B?" });
      await answered("How do I sort column B?");
      const asked = await bubble.webContents.executeJavaScript(`window.buddy.ask("Where is Save As?", {})`);
      // Reported after every window has closed: Buddy quitting must keep the conversations.
      app.once("will-quit", () => {
        console.log("RESTORE_FIRST", JSON.stringify({ tasks: tasks.list().map((t) => t.id), bubbleReply: asked?.reply ?? null, kept: kept() }));
        console.log("RESTORE_TEST_DONE");
      });
      app.quit();
      return;
    }
    const listed = tasks.list();
    const r = { listed, bubble: kit.brain?.transcript() ?? null, windowsBeforeOpen: !!taskWindow() };
    if (listed[0]) {
      tasks.open(listed[0].id);
      for (let i = 0; i < 50 && !taskWindow(); i++) await wait(100);
      await wait(1200);
      const win = taskWindow();
      r.shown = win ? await win.webContents.executeJavaScript(`document.getElementById("log").textContent`) : null;
      win?.webContents.executeJavaScript(`document.getElementById("input").value = "And undo that?"; document.getElementById("form").requestSubmit();`);
      await answered("And undo that?");
      await wait(300);
      r.keptAfterAsk = kept();
      tasks.close(listed[0].id);
      await wait(300);
      r.keptAfterClose = kept();
    }
    console.log("RESTORE_SECOND", JSON.stringify(r));
    console.log("RESTORE_TEST_DONE");
  }, 2500);
}

/** BUDDY_LESSONS_TEST=<path to the sample window script> @param {DevKit} kit */
function lessonsTest(kit) {
  // A lesson played in a test-owned native window (scripts/samples/context-window.ps1): Buddy points at the step and
  // follows it to its expected result with no model (this copy has none set up). A separate Brain, allowed to act
  // only in the sample, does the user's click. A lesson for a control that isn't there says so; one shared as a file
  // comes back the same.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (check, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await check()) return true; return false; };
  setTimeout(async () => {
    const r = {};
    let sample;
    try {
      const title = "Buddy lesson sample";
      sample = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", String(process.env.BUDDY_LESSONS_TEST), "-Focus", "-Title", title], { windowsHide: false });
      sample.stdout?.resume();
      sample.stderr?.resume();
      /** @type {any} */
      let target;
      if (!(await until(async () => (target = (await listWindows()).find((w) => w.title === title && w.pid === sample.pid))))) throw new Error("The sample window didn't open.");
      const { lessons, playLesson } = kit;
      if (!lessons) throw new Error("No lessons store.");
      // The user's hands: a Brain of the check's own, allowed to act only in the sample. It also waits until the
      // sample's controls can be read, so the lesson doesn't start on a window still drawing.
      const helper = new Brain({ status() {}, point: async () => {}, confirm: async () => "allow" });
      helper.target = target;
      helper.abort = new AbortController();
      const findRef = async () => {
        await helper.look({ app: target.app_name, window_id: target.id }, { windowOnly: true });
        return [...helper.labels].reverse().find(([, label]) => label.includes("Quarterly sales details"))?.[0];
      };
      if (!(await until(findRef))) throw new Error("The sample's control couldn't be read.");
      const added = /** @type {any} */ (lessons.add({ title: "Open the quarterly details", app: target.app_name, steps: [{ caption: "Open the details", target: "Quarterly sales details", done_when: ["Details opened"] }] }));
      const readyBefore = (fs.readFileSync(kit.timingLog(), "utf8").match(/"kind":"guide-ready"/g) ?? []).length;
      const playing = playLesson(added.lesson.id, { window: target });
      // Where the check is, so a stall shows where it stopped.
      const stage = (name) => console.log("LESSONS_STAGE", JSON.stringify({ name, mode: kit.currentMode() }));
      stage("playing");
      r.waited = await until(() => (fs.readFileSync(kit.timingLog(), "utf8").match(/"kind":"guide-ready"/g) ?? []).length > readyBefore);
      // The user's click.
      const ref = await findRef();
      r.clicked = ref ? (await helper.act({ action: "click", ref })).includes('"ok":true') : false;
      stage(`clicked ${r.clicked}`);
      r.played = await playing;
      stage("played");
      // A control that isn't there: the lesson says so and stops.
      const missing = /** @type {any} */ (lessons.add({ title: "Export the report", app: target.app_name, steps: [{ caption: "Export it", target: "Export to PDF", done_when: ["Exported"] }] }));
      r.missing = await playLesson(missing.lesson.id, { window: target });
      stage("missing played");
      // Shared as a file and imported again, it's the same lesson.
      const shared = /** @type {any} */ (lessons.importText(lessons.exportText(added.lesson.id) ?? ""));
      r.roundTrip = JSON.stringify(shared.lesson?.steps) === JSON.stringify(added.lesson.steps);
      r.listed = kit.settingsState().lessons.map((l) => l.title);
    } catch (err) {
      r.error = String(err?.message ?? err);
    } finally {
      sample?.kill();
    }
    console.log("LESSONS_TEST", JSON.stringify(r));
    console.log("LESSONS_TEST_DONE");
  }, 2500);
}

/** BUDDY_LANGUAGE_TEST @param {DevKit} kit */
function languageTest(kit) {
  // Buddy's windows in Spanish (this copy starts with uiLanguage "es"), then switched to English while they're open.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  setTimeout(async () => {
    const { bubble, island, changeSettings } = kit;
    const read = async () => ({
      ask: await bubble.webContents.executeJavaScript(`document.getElementById("submit").textContent`),
      allow: await bubble.webContents.executeJavaScript(`document.querySelector('[data-d="allow"]').textContent`),
      placeholder: await bubble.webContents.executeJavaScript(`document.getElementById("input").placeholder`),
      lang: await bubble.webContents.executeJavaScript(`document.documentElement.lang`),
      talk: await island.webContents.executeJavaScript(`document.getElementById("talk").textContent`),
      // For a failure: how many words the page holds, and whether setup was showing.
      page: await bubble.webContents.executeJavaScript(`({ strings: Object.keys(STRINGS).length, classes: document.body.className, busy })`),
    });
    // Each page applies its words when they arrive: wait for them rather than a fixed time.
    const inLanguage = async (lang) => {
      for (let i = 0; i < 50 && (await bubble.webContents.executeJavaScript(`document.documentElement.lang`)) !== lang; i++) await wait(100);
      await wait(200);
    };
    await inLanguage("es");
    const spanish = await read();
    // Every page of Settings in Spanish: any text on show with common English words in it is a word left behind.
    kit.settingsWindow.open();
    let settingsWin;
    for (let i = 0; i < 50 && !(settingsWin = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("settings.html"))); i++) await wait(100);
    await wait(1500);
    const leftEnglish = settingsWin ? await settingsWin.webContents.executeJavaScript(`(async () => {
      // Common English words that aren't Spanish ones, so a sentence left in English trips at least one. Any letter,
      // accented or not, is part of a word ("actúan" is no "an").
      const english = /(?<!\\p{L})(the|and|your|you|with|when|what|which|this|that|from|into|only|isn't|can't|don't|it's|will|would|click|press|choose|none|yet|here|there|asks?|asking|nothing|every|before|after|while|is|are|to|for|of|in|it|or|not|can|without|may|off|on|be|by|an|its|they|them|use|new|add|show|open)(?!\\p{L})/iu;
      const seen = new Set();
      for (const page of pages) {
        show(page);
        await new Promise((r) => setTimeout(r, 150));
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const text = n.textContent.trim();
          const shown = n.parentElement && n.parentElement.offsetParent !== null;
          if (text && shown && english.test(text)) seen.add(page + ": " + text.slice(0, 90));
        }
        for (const el of document.querySelectorAll("[title], [aria-label], [placeholder]")) {
          for (const a of ["title", "aria-label", "placeholder"]) {
            const v = el.getAttribute(a);
            if (v && el.offsetParent !== null && english.test(v)) seen.add(page + " [" + a + "]: " + v.slice(0, 90));
          }
        }
      }
      return [...seen];
    })()`) : ["Settings didn't open"];
    // Two of the wordiest pages, to see the Spanish fits.
    for (const page of ["agents", "claude"]) {
      await settingsWin?.webContents.executeJavaScript(`show(${JSON.stringify(page)})`);
      await wait(400);
      if (settingsWin) fs.writeFileSync(path.join(process.env.BUDDY_LANGUAGE_TEST, `settings-${page}-es.png`), (await settingsWin.webContents.capturePage()).toPNG());
    }
    settingsWin?.close();
    changeSettings({ uiLanguage: "en" });
    await inLanguage("en");
    const english = await read();
    // Setup (no AI chosen in this copy) in Spanish, with the approval card up where longer words could crowd the
    // buttons; then switched while it's showing.
    changeSettings({ uiLanguage: "es" });
    await inLanguage("es");
    await kit.summon();
    await bubble.webContents.executeJavaScript(`document.getElementById("what").textContent = "Haz clic en Guardar"; document.getElementById("confirm").classList.add("on")`);
    await wait(700);
    fs.writeFileSync(path.join(process.env.BUDDY_LANGUAGE_TEST, "bubble-es.png"), (await bubble.webContents.capturePage()).toPNG());
    const setupSpanish = await bubble.webContents.executeJavaScript(`document.querySelector("#welcome .lede")?.textContent ?? null`);
    changeSettings({ uiLanguage: "en" });
    await inLanguage("en");
    await wait(500);
    const setupEnglish = await bubble.webContents.executeJavaScript(`document.querySelector("#welcome .lede")?.textContent ?? null`);
    console.log("LANGUAGE_TEST", JSON.stringify({ spanish, english, setupSpanish, setupEnglish, leftEnglish }));
    console.log("LANGUAGE_TEST_DONE");
  }, 2500);
}

/** BUDDY_CONNECTIONS_TEST @param {DevKit} kit */
function connectionsTest(kit) {
  // A service connected and used through the real app: a stand-in service and model on this PC (scripts/e2e.mjs).
  // On its site the bubble offers to connect; Connect signs in; a question uses its tool after Allow on the card.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (check, ms = 15_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await check()) return true; return false; };
  setTimeout(async () => {
    const r = {};
    try {
      const { bubble } = kit;
      const js = (code) => bubble.webContents.executeJavaScript(code);
      await kit.summon();
      await kit.offerConnection({ title: "Q3 budget - docs.test - Microsoft Edge", app_name: "msedge.exe" });
      r.offered = await until(() => js(`!document.getElementById("connect-offer").hidden`), 5000);
      r.offer = await js(`document.getElementById("connect-offer-text").textContent`);
      await js(`document.getElementById("connect-yes").click()`);
      r.connected = await until(() => !!kit.connectors?.connected("testdocs"));
      await wait(500);
      r.after = await js(`document.getElementById("connect-offer-text").textContent`);
      // A second offer for the same site doesn't come: it's connected now.
      await kit.offerConnection({ title: "Q3 budget - docs.test - Microsoft Edge", app_name: "msedge.exe" });
      const answer = js(`window.buddy.ask("Find the budget in my documents", {})`);
      r.carded = await until(() => js(`document.getElementById("confirm").classList.contains("on")`));
      r.card = await js(`document.getElementById("what").textContent`);
      await wait(700);
      await js(`document.querySelector('[data-d="allow"]').click()`);
      r.reply = (await answer)?.reply ?? null;
      r.listed = kit.settingsState().connections.map((c) => `${c.id}:${c.connected}`);
    } catch (err) {
      r.error = String(err?.message ?? err);
    }
    console.log("CONNECTIONS_TEST", JSON.stringify(r));
    console.log("CONNECTIONS_TEST_DONE");
  }, 2500);
}

/** BUDDY_SETTINGS_AUDIT_TEST @param {DevKit} kit */
function settingsAuditTest(kit) {
  // Every control in Settings, used the way a person does (a click, typing, a key pressed in the shortcut recorder)
  // in the real Settings window: the setting must be saved, the control must show it, and where Buddy shows the
  // effect elsewhere (the island's colour, the bubble's language, the plates' theme, a shortcut, the Agents rules),
  // that must change too. Controls that would change this PC from a test copy (Start with Windows, adding Buddy to AI
  // apps, links that open the browser) aren't clicked here.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  setTimeout(async () => {
    /** @type {{ step: string, problem: string }[]} */
    const problems = [];
    let passed = 0;
    try {
      // A saved plate, for Clear… to delete (the e2e check seeds a kept conversation for Forget).
      const plates = path.join(app.getPath("userData"), "explainers");
      fs.mkdirSync(plates, { recursive: true });
      fs.writeFileSync(path.join(plates, "audit.html"), "<p>plate</p>");
      kit.settingsWindow.open();
      let win;
      for (let i = 0; i < 50 && !(win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("settings.html"))); i++) await wait(100);
      await wait(1500);
      const page = (code) => win.webContents.executeJavaScript(code);
      const saved = () => JSON.parse(fs.readFileSync(kit.settingsFile(), "utf8"));
      const show = (p) => page(`show(${JSON.stringify(p)})`);
      // Clicks the button in #box whose words are `text` (or whose aria-label is), as a person would.
      const click = (box, text) => page(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(`#${box} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.getAttribute("aria-label") === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`);
      const pressed = (box, text) => page(`[...document.querySelectorAll(${JSON.stringify(`#${box} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})?.getAttribute("aria-pressed") ?? [...document.querySelectorAll(${JSON.stringify(`#${box} button`)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)})?.getAttribute("aria-checked")`);
      const checked = (id) => page(`document.getElementById(${JSON.stringify(id)}).getAttribute("aria-checked")`);
      const step = async (name, act, ...checks) => {
        try {
          const did = await act();
          if (did === false) return problems.push({ step: name, problem: "the control wasn't there to use" });
          await wait(450);
          for (const check of checks) {
            const problem = await check();
            if (problem) return problems.push({ step: name, problem });
          }
          passed++;
        } catch (err) {
          problems.push({ step: name, problem: String(err?.message ?? err) });
        }
      };
      const is = (what, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? null : `${what} is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
      const visible = (id) => page(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.closest("[hidden]") && e.getClientRects().length > 0; })()`);

      // ---------- The page list down the side ----------
      for (const name of ["voice", "dictation", "look", "keys", "agents", "lessons", "claude", "activity", "about"]) {
        await step(`the ${name} page`, () => page(`document.querySelector('nav button[data-page="${name}"], button[data-page="${name}"]').click()`),
          async () => is(`page-${name} showing`, await visible(`page-${name}`), true));
      }
      await step("Change… under the dictation shortcut", async () => { await show("dictation"); await page(`document.getElementById("dictate-change").click()`); },
        async () => is("the Shortcuts page showing", await visible("page-keys"), true));

      // ---------- Voice & speech ----------
      await show("voice");
      await step("voice", () => page(`document.querySelector('#voices button[data-sid="4"]').click()`),
        () => is("saved voice", saved().voice, 4), async () => is("voice 4's card", await page(`document.querySelector('#voices button[data-sid="4"]').getAttribute("aria-checked")`), "true"));
      await step("speed", () => page(`(() => { const r = document.getElementById("speed"); r.value = "1.2"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); })()`),
        () => is("saved speed", saved().speed, 1.2), async () => is("speed shown", await page(`document.getElementById("speed-out").textContent`), "1.20×"));
      await step("talk back: never", () => click("talkback", "Never"),
        () => is("saved talkBack", saved().talkBack, "never"), async () => is("Never", await pressed("talkback", "Never"), "true"));

      // ---------- Dictation ----------
      await show("dictation");
      await step("dictation stops: when I press it again", () => click("dictate-stop", "When I press it again"), () => is("saved dictateStop", saved().dictateStop, "press"));
      await step("listening language: detect", () => click("language", "Detect automatically"), () => is("saved language", saved().language, "auto"));

      // ---------- Look ----------
      await show("look");
      const islandAccent = () => island.webContents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue("--buddy").trim()`);
      const { island, bubble } = kit;
      // The sample under Explainer appearance, in the same colours as a real plate's paper (explainer.css).
      const samplePaper = () => page(`getComputedStyle(document.getElementById("plate-sample")).backgroundColor`);
      await step("accent: green", () => page(`[...document.querySelectorAll("#swatches button")].find((b) => b.textContent.includes("Green")).click()`),
        () => is("saved accent", saved().accent, "green"), async () => is("the island's colour", (await islandAccent()).toLowerCase(), "#16a34a"));
      await step("explainer appearance: light", () => click("appearance", "Light"),
        () => is("saved appearance", saved().appearance, "light"), () => is("the theme plates follow", nativeTheme.themeSource, "light"), async () => is("Light", await pressed("appearance", "Light"), "true"),
        async () => is("the sample plate", await samplePaper(), "rgb(242, 244, 240)"));
      await step("explainer appearance: dark", () => click("appearance", "Dark"), () => is("the theme plates follow", nativeTheme.themeSource, "dark"),
        async () => is("the sample plate", await samplePaper(), "rgb(19, 24, 21)"));
      // The Look page in Dark, for a person to look over (the variable is the e2e run's folder).
      await page(`document.getElementById("plate-sample").scrollIntoView({ block: "end" })`);
      await wait(200);
      if (fs.existsSync(process.env.BUDDY_SETTINGS_AUDIT_TEST ?? "")) fs.writeFileSync(path.join(process.env.BUDDY_SETTINGS_AUDIT_TEST, "settings-look.png"), (await win.webContents.capturePage()).toPNG());
      await step("language: Español", () => click("ui-language", "Español"),
        () => is("saved uiLanguage", saved().uiLanguage, "es"), async () => is("the bubble's language", await bubble.webContents.executeJavaScript("document.documentElement.lang"), "es"));
      await step("language: back to English", () => click("ui-language", "English"), async () => is("Settings' language", await page("document.documentElement.lang"), "en"));

      // ---------- Shortcuts ----------
      await show("keys");
      await step("record a shortcut for Mark", async () => {
        const ok = await page(`(() => { const c = document.querySelectorAll("#keys .keycap")[2]; if (!c) return false; c.click(); return true; })()`);
        if (!ok) return false;
        await wait(300);
        await page(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, altKey: true, bubbles: true }))`);
      }, () => is("saved Mark shortcut", saved().hotkeys.mark, "Control+Alt+J"), () => is("Ctrl+Alt+J registered", globalShortcut.isRegistered("Control+Alt+J"), true), () => is("the old one let go", globalShortcut.isRegistered("Control+Alt+M"), false));
      await step("reset that shortcut", () => page(`(() => { const b = [...document.querySelectorAll("#keys button.link")].find((x) => x.textContent.trim() === "Reset"); if (!b) return false; b.click(); })()`),
        // When another Buddy on this PC holds Ctrl+Alt+M (the owner's, say), the reset is refused and Settings says why.
        async () => (saved().hotkeys.mark === "Control+Alt+M" ? is("Ctrl+Alt+M registered", globalShortcut.isRegistered("Control+Alt+M"), true)
          : is("why the reset was refused", await page(`document.querySelector("#keys").textContent.includes("Another app already uses this shortcut")`), true)));
      await step("hold to talk: off", () => page(`document.getElementById("hold-to-talk").click()`),
        () => is("saved holdToTalk", saved().holdToTalk, false), async () => is("its switch", await checked("hold-to-talk"), "false"));

      // ---------- Agents ----------
      await show("agents");
      await step("advanced features: on", () => page(`document.getElementById("advanced").click()`),
        () => is("saved advanced", saved().advanced, true), async () => is("the bubble's basic mode", await bubble.webContents.executeJavaScript(`document.body.classList.contains("basic")`), false));
      await step("agents may: make safe moves", () => click("rope", "Make safe movesScroll, expand and collapse, and move windows without asking. Anything that clicks, types or opens an app still asks.") || page(`[...document.querySelectorAll("#rope button")][1].click()`),
        () => is("saved rope", saved().rope, "safe"), async () => is("a scroll in Notepad", (await import("./policy.js")).decide(kit.settings, { kind: "scroll_to", app: "notepad.exe" }), "allow"));
      await step("trust Notepad", () => page(`(() => { const i = document.getElementById("trusted-input"); i.value = "Notepad"; document.getElementById("trusted-add").click(); })()`),
        () => is("saved trustedApps", saved().trustedApps, ["Notepad"]));
      await step("stop blocking Keeper", () => click("blocked", "Remove Keeper"),
        () => (saved().blockedApps.includes("Keeper") ? "Keeper is still blocked" : null), async () => is("Keeper's chip", await page(`[...document.querySelectorAll("#blocked .app-chip")].some((c) => c.textContent.includes("Keeper"))`), false));
      await step("block Keeper again", () => page(`(() => { const i = document.getElementById("blocked-input"); i.value = "Keeper"; document.getElementById("blocked-add").click(); })()`),
        async () => is("KeePass-style blocking", (await import("./policy.js")).decide(kit.settings, { kind: "scroll_to", app: "Keeper.exe" }), "block"));
      await step("let Buddy run commands: on", () => page(`document.getElementById("commands").click()`),
        () => is("saved commands", saved().commands, true), async () => is("its switch", await checked("commands"), "true"));
      kit.changeSettings({ readFolders: [path.join(os.homedir(), "Projects")] });
      await wait(300);
      await step("folders: back to the usual ones", () => page(`document.getElementById("folders-usual").click()`),
        () => is("saved readFolders", saved().readFolders, null), async () => is("the link", await page(`document.getElementById("folders-usual").hidden`), true));

      // ---------- AI & privacy ----------
      await show("claude");
      await step("window screenshots: off", () => page(`document.getElementById("screen-context").click()`),
        () => is("saved screenContext", saved().screenContext, false), async () => is("its switch", await checked("screen-context"), "false"));
      await step("model: Haiku", () => page(`[...document.querySelectorAll("#models button")].find((b) => b.textContent.includes("Haiku")).click()`),
        () => is("saved model", saved().model, "claude-haiku-5-5"), async () => is("Haiku's choice", await page(`[...document.querySelectorAll("#models button")].find((b) => b.textContent.includes("Haiku")).getAttribute("aria-checked")`), "true"));
      await step("thinking effort: high", () => click("effort", "High"), () => is("saved effort", saved().effort, "high"));
      await step("quick model: Haiku", () => page(`(() => { const s = document.getElementById("quick-model"); s.value = "claude-haiku-5-5"; s.dispatchEvent(new Event("change")); })()`),
        () => is("saved quick model", saved().quickModels, { anthropic: "claude-haiku-5-5" }));
      await step("monthly limit: $25", () => page(`(() => { const c = document.getElementById("cap"); c.value = "25"; c.dispatchEvent(new Event("change")); })()`),
        () => is("saved monthlyCap", saved().monthlyCap, 25));
      await step("provider: Ollama", () => page(`[...document.querySelectorAll("#provider button")].find((b) => b.textContent.includes("Ollama")).click()`),
        () => is("saved provider", saved().provider, "ollama"), async () => is("Ollama's choice", await page(`[...document.querySelectorAll("#provider button")].find((b) => b.textContent.includes("Ollama")).getAttribute("aria-checked")`), "true"));
      await step("Ollama's address, saved", () => page(`(() => { const i = document.getElementById("address-input"); i.value = "http://127.0.0.1:1"; [...document.querySelectorAll("#address button")].find((b) => b.textContent.trim() === "Save address").click(); })()`),
        () => is("saved address", saved().providerURLs.ollama, "http://127.0.0.1:1"), async () => is("its box", await page(`document.getElementById("address-input").value`), "http://127.0.0.1:1"));
      await step("Ollama's address: Use the usual one", () => click("address", "Use the usual one"),
        () => (saved().providerURLs.ollama && saved().providerURLs.ollama !== "http://localhost:11434/v1" ? `saved address is still ${saved().providerURLs.ollama}` : null));
      await step("provider: back to Anthropic", () => page(`[...document.querySelectorAll("#provider button")].find((b) => b.textContent.includes("Anthropic")).click()`), () => is("saved provider", saved().provider, "anthropic"));
      await step("saved plates: Clear…, then Keep", async () => { await click("explainers-actions", "Clear…"); await wait(200); return click("explainers-actions", "Keep"); },
        () => is("the plate", fs.existsSync(path.join(plates, "audit.html")), true));
      await step("saved plates: Clear…, then Delete", async () => { await click("explainers-actions", "Clear…"); await wait(200); return click("explainers-actions", "Delete 1"); },
        () => is("the plate", fs.existsSync(path.join(plates, "audit.html")), false), async () => is("the count", (await page(`document.getElementById("explainers-count").textContent`)).trim(), "None yet."));
      await step("conversations: Forget", () => click("conversations-actions", "Forget"),
        () => is("conversations.json", fs.existsSync(path.join(app.getPath("userData"), "conversations.json")), false), async () => is("Forget", await page(`document.querySelector("#conversations-actions button").disabled`), true));
      await step("API key: typed and the box takes it", () => page(`(() => { const i = document.getElementById("key-input"); if (!i) return false; i.value = "x"; return true; })()`),
        async () => is("the key box", await page(`document.getElementById("key-input").type`), "password"));
      kit.trace({ kind: "audit-marker" });
      await step("clear the activity log", () => page(`(() => { const b = document.querySelector("#log-actions button"); if (!b || b.disabled) return false; b.click(); })()`),
        () => (fs.existsSync(kit.timingLog()) && fs.readFileSync(kit.timingLog(), "utf8").includes("audit-marker") ? "the log still has what was in it" : null));

      // ---------- Routines ----------
      await show("routines");
      await step("new routine, saved", async () => {
        if ((await page(`(() => { const b = document.getElementById("routine-new"); b.click(); return true; })()`)) === false) return false;
        await wait(300);
        await page(`(() => { const e = document.getElementById("routine-editor"); const n = e.querySelector("input.field"); n.value = "Morning check"; n.dispatchEvent(new Event("input")); const p = e.querySelector("textarea"); p.value = "Summarise my unread email."; p.dispatchEvent(new Event("input")); [...e.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save routine").click(); })()`);
      }, () => is("saved routines", saved().routines.map((r) => r.name), ["Morning check"]), async () => is("its row", await page(`document.getElementById("routines").textContent.includes("Morning check")`), true));
      await step("routine: off", () => click("routines", "Morning check: on"),
        () => is("saved enabled", saved().routines[0]?.enabled, false), async () => is("its switch", await page(`document.querySelector("#routines .switch").getAttribute("aria-checked")`), "false"));
      await step("routine: Edit, renamed, saved", async () => {
        if ((await click("routines", "Edit")) === false) return false;
        await wait(300);
        await page(`(() => { const e = document.getElementById("routine-editor"); const n = e.querySelector("input.field"); n.value = "Evening check"; n.dispatchEvent(new Event("input")); [...e.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save routine").click(); })()`);
      }, () => is("saved routines", saved().routines.map((r) => r.name), ["Evening check"]));
      await step("routine: Delete, then Keep it", async () => { await click("routines", "Delete"); await wait(200); return click("routines", "Keep it"); },
        () => is("saved routines", saved().routines.length, 1));
      await step("routine: Delete, then Delete it", async () => { await click("routines", "Delete"); await wait(200); return click("routines", "Delete it"); },
        () => is("saved routines", saved().routines.length, 0));

      // ---------- About & updates ----------
      await show("about");
      await step("Report a problem: preview", () => page(`document.getElementById("report").click()`),
        async () => is("the preview", await visible("report-text"), true), async () => ((await page(`document.getElementById("report-text").value.length`)) < 50 ? "the preview is empty" : null));
      await step("Report a problem: Cancel", () => page(`document.getElementById("report-cancel").click()`), async () => is("the preview", await visible("report-text"), false));
      // Run from source there is nothing to update, so the switch is greyed out and the status says so; installed, it flips.
      const fromSource = await page(`document.getElementById("auto-update").disabled`);
      if (fromSource) await step("automatic updates (from source)", () => true, async () => is("the update status", await page(`document.getElementById("update-status").textContent`), "Running from source: update with git."));
      else await step("automatic updates: off", () => page(`document.getElementById("auto-update").click()`),
        () => is("saved autoUpdate", saved().autoUpdate, false), async () => is("its switch", await checked("auto-update"), "false"));
      // Closing can take the page away before the click's own call returns: that is the button working, not a failure.
      await step("the close button", () => page(`document.getElementById("close").click()`).catch((e) => { if (!/disposed|destroyed/i.test(String(e?.message))) throw e; }),
        () => is("Settings showing", !win.isDestroyed() && win.isVisible(), false));
    } catch (err) {
      problems.push({ step: "audit", problem: String(err?.message ?? err) });
    }
    console.log("SETTINGS_AUDIT", JSON.stringify({ passed, problems }));
    console.log("SETTINGS_AUDIT_DONE");
  }, 2500);
}

const HOOKS = {
  BUDDY_SETTINGS_AUDIT_TEST: settingsAuditTest,
  BUDDY_CONNECTIONS_TEST: connectionsTest,
  BUDDY_LANGUAGE_TEST: languageTest,
  BUDDY_LESSONS_TEST: lessonsTest,
  BUDDY_RESTORE_TEST: restoreTest,
  BUDDY_BRIDGE_TEST: bridgeTest,
  BUDDY_ISLAND_TEST: islandTest,
  BUDDY_POINT_TEST: pointTest,
  BUDDY_MARK_TEST: markTest,
  BUDDY_TASK_TEST: taskTest,
  BUDDY_VOICE_TEST: voiceTest,
  BUDDY_APPROVAL_TEST: approvalTest,
  BUDDY_SETTINGS_TEST: settingsTest,
  BUDDY_EXPLAINER_TEST: explainerTest,
  BUDDY_MARK_STARTUP_TEST: markStartupTest,
  BUDDY_MARK_RENDER_TEST: markRenderTest,
  BUDDY_ANNOTATIONS_TEST: annotationsTest,
  BUDDY_SCREEN_CONTEXT_TEST: screenContextTest,
  BUDDY_CONVERSATION_TEST: conversationTest,
  BUDDY_FILES_TEST: filesTest,
  BUDDY_WELCOME_TEST: welcomeTest,
};
