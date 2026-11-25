// Desktop Buddy: tray app, island, global hotkeys, pointer overlay, speech bubble and explainers around the Brain.
import {
  app, BrowserWindow, clipboard, ClipboardItem, desktopCapturer, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen,
  session, shell, Tray, webContents,
} from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPS, APP_IDS, appStatus } from "./ai-apps.js";
import { Brain, GUIDE_SNAPSHOT, SESSION_PREFIX, setAgentPolicy, setBrainDefaults, takeTurn } from "./brain.js";
import { PROVIDERS, testedOf, verdict } from "./providers.js";
import { CASES } from "./evals.js";
import { createActivity, pruneUndo } from "./activity.js";
import { createProviderState } from "./provider-state.js";
import { grantProblem, placesHere } from "./pc-tools.js";
import { createLog } from "./log.js";
import { questionTiming } from "./latency.js";
import { createHoldKey, uiohookHook } from "./hold-key.js";
import { createApprovalQueue } from "./approval-queue.js";
import { islandView } from "./island-state.js";
import { dictationPaste, returnFocus } from "./approvals.js";
import { elementAt, findControl, foregroundWindow, listWindows, perform, resolveBinary, snapshotResilient, windowAt } from "./desktop.js";
import { createTasks } from "./tasks.js";
import { asDipPoint, asDipRect, asPhysicalPoint, asPhysicalRect, modelPictureSize } from "./geometry.js";
import { BUSY, canMove } from "./modes.js";
import {
  ACCENTS, DEFAULTS, EFFORTS, HOTKEY_NAMES, MODELS, SPEED, VOICES, load as loadSettings, normalize as normalizeSettings,
  save as saveSettings, update as updateSettings,
} from "./settings.js";
import { createSettingsWindow } from "./settings-window.js";
import { lockExplainerSession, openExplainer as openPlate } from "./explainer-window.js";
import { setStartsWithWindows, startsWithWindows, writeShortcuts as writeLaunchShortcuts } from "./launch.js";
import { PLUS_INTEREST, RELEASES, problemReport, requestFeature, sendProblemReport } from "./feedback.js";
import { createBlender } from "./blender.js";
import { createUpdates } from "./updates.js";
import { describe as describeSchedule, nextRun, verdict as routineVerdict } from "./routines.js";
import os from "node:os";
import { createVoice } from "./voice.js";
import { createReplyStream } from "./reply-stream.js";
import { createTurnQueue } from "./turn-queue.js";
import { centerOf, createAnnotationLayer, guessGone, insideBox, sameBox } from "./annotations.js";
import { abortable } from "./marker-startup.js";
import { overlayProgram, startOverlay } from "./marker-live.js";
import { createMarker } from "./marker.js";
import { createAiAppSetup } from "./ai-app-setup.js";
import { createAppBridge } from "./app-bridge.js";
import { createConversations } from "./conversations.js";
import { REPAIR_SYSTEM, STARTER, appName, createLessons, lessonsFor, namedControls, parsePick, repairQuestion, repairedStep } from "./lessons.js";
import { createConnectors, siteConnector } from "./connectors.js";
import { writeDocx } from "./documents.js";
import { callQualityMic, createMeetingNotes, createMeetingSession, recoverTranscript } from "./meeting.js";
import { createMeetingCapture } from "./meeting-capture.js";
import { LANGUAGES, N, language, pickLanguage, setLanguage, t, table } from "./i18n.js";
import { appKey } from "./policy.js";
import { appWords, tourNext, tourTip } from "./welcome.js";
import { aboutMoney, addCall, capProblem, createLedger, moneyWords, noSpend, priceOf, spendLine, tokenWords } from "./costs.js";

/** @typedef {import("./geometry.js").DipPoint} DipPoint */
/** @typedef {import("./geometry.js").DipRect} DipRect */
/** @typedef {import("./geometry.js").PhysicalPoint} PhysicalPoint */
/** @typedef {import("./geometry.js").PhysicalRect} PhysicalRect */

const here = path.dirname(fileURLToPath(import.meta.url));
// Global shortcuts come from Settings (the defaults in settings.js avoid Ctrl+Alt+Space, the Claude desktop app's
// Quick Entry, and Ctrl+Alt+V, Paste Special in Office). BUDDY_*_HOTKEY environment variables override them.
/** @type {Record<import("./settings.js").HotkeyName, string | undefined>} */
const ENV_HOTKEYS = { ask: process.env.BUDDY_HOTKEY, talk: process.env.BUDDY_TALK_HOTKEY, mark: process.env.BUDDY_MARK_HOTKEY, explain: process.env.BUDDY_EXPLAIN_HOTKEY, dictate: process.env.BUDDY_DICTATE_HOTKEY };
const IDLE_RESET_MS = 15 * 60_000;
// The window starts at the top of the island so the card can slide out from under the pill; the card itself
// sits 46px down (see bubble.html).
const BUBBLE = { width: 400, height: 306 };
const BUBBLE_FOLD_MS = 300; // matches the close transition in bubble.html
// Tall enough for a task preview to drop out of the pill; everything below the pill is transparent and
// click-through unless a preview is showing.
const ISLAND = { width: 460, height: 440 };
const PEEK_EVERY_MS = 800;
const CROP = { width: 1200, height: 800 }; // physical px around the pointer sent with an explain request

// The installed app's shortcuts carry the installer's app ID (electron-builder's appId), so the taskbar groups Buddy's
// windows with them; a source checkout keeps the ID its own shortcuts were made with.
const APP_ID = app.isPackaged ? "io.github.donlapidos.desktopbuddy" : "Desktop Buddy";

// Settings, the API key and the voice models live in %APPDATA%\desktop-buddy for a source checkout and an installed
// Buddy alike, whatever the installer calls the app, so installing or updating never loses them. An explicit
// --user-data-dir (separate test copies) still wins.
if (!app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", path.join(app.getPath("appData"), "desktop-buddy"));

// One Buddy at a time: launching it again (shortcut, Start menu) opens the Ask bubble in the running one.
if (!app.requestSingleInstanceLock()) app.quit();
// Chromium stops painting windows it thinks are covered, and it counts Buddy's full-screen transparent
// overlay as cover. That left the island blank, so always paint Buddy's windows.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
// On this dual-GPU laptop the GPU compositor stopped putting Buddy's transparent windows on screen: the island
// rendered (its own capture showed it) and sat topmost, yet the screen stayed empty. Software compositing draws
// them reliably and is plenty for Buddy's small surfaces. BUDDY_GPU=1 turns acceleration back on.
if (!process.env.BUDDY_GPU) app.disableHardwareAcceleration();
app.on("second-instance", () => summon());

let tray, bubble, island, brain, tasks, voice, updates;
let answeringBrain = null;
let heardLang = "en"; // the language of the last thing heard, waiting for the bubble to send it as a question
let heardTiming = null; // when that speech ended and how long hearing it took, for the ask-to-pointer timing
/** @type {import("./latency.js").QuestionTiming | null} the bubble question being answered's ask-to-pointer clock */
let questionClock = null;

// The answer running (or the last one): whether its question was said out loud and in what language (spoken
// answers are read back, in that language), when it started, and whether it showed a plate. Each answer replaces it
// whole, so nothing of one question carries into the next.
/** @typedef {{ spoken: boolean, lang: string, at: number, explainerShown: boolean }} Turn */
/** @type {Turn} */
let turn = { spoken: false, lang: "en", at: 0, explainerShown: false };
const startTurn = ({ spoken = false, lang = "en" } = {}) => (turn = { spoken, lang, at: Date.now(), explainerShown: false });
let replyMuted = false;
const liveReply = createReplyStream({
  display: (text) => bubble?.webContents.send("reply-stream", text),
  // The island shows the sentence that started the reply; the ones that follow on join it.
  speak: async (text, how) => {
    if (!how.join) saying = oneLine(text);
    await voice?.say(text, undefined, how);
  },
  hush: () => voice?.hush(),
  canSpeak: () => speaksNow(),
});
function hushReply() {
  replyMuted = true;
  liveReply.cancel();
  voice?.hush();
}
const bubbleTurns = createTurnQueue({ stop: () => { answeringBrain?.cancel(); hushReply(); } });

// What the next question is about: the window the user was in and the point on screen (plates open beside it). Set
// together, when they call Buddy, finish marking, or click something to explain.
/** @type {{ window: any, point: DipPoint | null }} */
let about = { window: null, point: null };
// What the island shows is worked out from what Buddy is doing (island-state.js). These are the facts that aren't
// held anywhere else: the running activity's latest line, an AI app's call, a download, and the last outcome.
const islandFacts = {
  /** @type {string | null} */ progress: null,
  transcribing: false,
  /** @type {string | null} */ appCall: null,
  /** @type {string | null} */ download: null,
  /** @type {string | null} */ notice: null,
  /** @type {string | null} */ meeting: null, // "Taking notes · 12 min" while meeting notes are on
};
let islandShown = ""; // what was last sent, so an unchanged island isn't re-sent
let islandState = "idle"; // for the CPU log
/** @type {import("./settings.js").Settings} */
let settings = normalizeSettings({}); // loaded from disk once the app is ready
let saying = "Speaking"; // the island's label while Buddy reads a reply aloud
const overlays = new Map();
// What Buddy is doing (see modes.js). Requests waiting for the user's OK are in `approvals` (approval-queue.js).
/** @typedef {import("./modes.js").Mode} Mode */
/** @type {Mode} */
let mode = "idle";

// The mode as it is now. Code that awaited something re-checks with this, because a hotkey or the bubble may have
// moved Buddy on in the meantime (the checker otherwise assumes `mode` can't change across an await).
/** @returns {Mode} */
const currentMode = () => mode;

// Every change of mode goes through here. A move modes.js doesn't allow is refused and logged to timing.log: it's a
// bug, and better caught than half-done.
/** @param {Mode} next @returns {boolean} whether the move happened */
function enter(next) {
  if (!canMove(mode, next)) {
    trace({ kind: "refused-mode-change", from: mode, to: next });
    return false;
  }
  if (next !== mode) {
    islandFacts.progress = null;
    islandFacts.transcribing = false;
    // A new activity replaces the last outcome; going back to idle leaves the outcome to be shown.
    if (next !== "idle") islandFacts.notice = null;
  }
  mode = next;
  showIsland();
  return true;
}
let displayCaptures = 0;
let bubbleHideTimer = null;

const ownPids = () => [process.pid, ...app.getAppMetrics().map((m) => m.pid)];

// Crossing between DIP and physical pixels (see geometry.js). These are the only crossings.
/** @param {DipPoint} p @returns {PhysicalPoint} */
const toPhysicalPoint = (p) => asPhysicalPoint(process.platform === "win32" ? screen.dipToScreenPoint(p) : p);
/** @param {DipRect} r @returns {PhysicalRect} */
const toPhysicalRect = (r) => asPhysicalRect(process.platform === "win32" ? screen.dipToScreenRect(null, r) : r);
/** @param {PhysicalPoint} p @returns {DipPoint} */
const toDipPoint = (p) => asDipPoint(process.platform === "win32" ? screen.screenToDipPoint(p) : p);
/** @param {PhysicalRect} r @returns {DipRect} */
const toDipRect = (r) => asDipRect(process.platform === "win32" ? screen.screenToDipRect(null, r) : r);
const cursor = () => asDipPoint(screen.getCursorScreenPoint());

// ---------- Who Buddy thinks with (provider-state.js): keys, addresses, model lists, the model check ----------

const providerState = createProviderState({
  dataDir: () => app.getPath("userData"),
  safeStorage,
  settings: () => settings,
  change: (patch) => changeSettings(patch),
  restart: () => startBrain(),
  refresh: () => settingsWindow?.refresh(),
  trace: (entry) => trace(entry),
});
const {
  keyFile, currentProvider, envKey, boundToAddress, savedKey, loadApiKey, saveApiKey, setApiKey, providerURL, providerReady, setAddress,
  providerModelLists, modelListState, refreshModels, loadModelCaps, chosenModel, checkModel,
} = providerState;

// ---------- Activity: what Buddy changed, and undoing it (activity.js), shown in Settings › Activity ----------

/** @type {ReturnType<typeof createActivity> | null} */
let activity = null;
function startActivity() {
  // Old undo copies go at startup too, not only when a new one is made.
  pruneUndo(path.join(app.getPath("userData"), "undo"));
  activity = createActivity({
    file: path.join(app.getPath("userData"), "activity.json"),
    undoDir: path.join(app.getPath("userData"), "undo"),
    // End-to-end checks put "trashed" files in a bin of their own, not the user's Recycle Bin.
    trash: process.env.BUDDY_E2E
      ? async (file) => {
          const bin = path.join(app.getPath("userData"), "e2e-bin");
          fs.mkdirSync(bin, { recursive: true });
          fs.renameSync(file, path.join(bin, path.basename(file)));
        }
      : (file) => shell.trashItem(file),
    onChange: () => settingsWindow?.refresh(),
  });
}
// ---------- What thinking costs (costs.js): each answer's spend, the month's, and the limit ----------

/** @type {ReturnType<typeof createLedger> | null} */
let ledger = null;
/** @type {ReturnType<typeof createConversations> | null} the bubble's and tasks' conversations, kept on the PC */
let conversations = null;
// ---------- Connections (connectors.js): services Buddy can use as well as the screen ----------

/** @type {ReturnType<typeof createConnectors> | null} */
let connectors = null;
// What every Brain is handed: the connected services' tools, named and run (asking first is brain.js's).
const connectorsUI = {
  tools: () => connectors?.tools() ?? [],
  describe: (/** @type {string} */ name) => connectors?.describe(name) ?? null,
  call: (/** @type {string} */ name, /** @type {any} */ input, /** @type {AbortSignal | undefined} */ signal) => connectors?.call(name, input, signal) ?? Promise.resolve("That service isn't connected."),
};
// End-to-end checks have no person to sign in: their stand-in sign-in page on this PC is followed straight through.
async function openSignIn(/** @type {string} */ url) {
  if (!process.env.BUDDY_E2E) return shell.openExternal(url);
  const first = await fetch(url, { redirect: "manual" });
  const back = first.headers.get("location");
  if (back) await fetch(back);
}
const connectionsOffered = new Set(); // services offered (and put off) since Buddy started

/**
 * On a site Buddy can connect to (Notion, Linear, Jira…), the bubble offers it once, with the advanced features on:
 * from the window's title, or the address bar in what Buddy read of it.
 */
async function offerConnection(/** @type {any} */ win) {
  if (!win || !connectors || !settings.advanced) return;
  const read = await Promise.race([brain?.preview?.text ?? Promise.resolve(""), new Promise((r) => setTimeout(() => r(""), 4000))]).catch(() => "");
  const c = siteConnector(`${win.title ?? ""}\n${read ?? ""}`, connectors.list().map((x) => /** @type {any} */ (connectors?.get(x.id))));
  if (!c || connectors.connected(c.id) || settings.connectionsDeclined.includes(c.id) || connectionsOffered.has(c.id)) return;
  connectionsOffered.add(c.id);
  trace({ kind: "connector-offered", id: c.id });
  bubble.webContents.send("connect-offer", { id: c.id, state: "offer", text: t("Connect Buddy to {service}? Then it can {does} for you, asking you first.", { service: t(c.label), does: t(c.does) }) });
}

/** Connects a service: the browser opens for signing in. Resolves an error in words, or null. */
async function connectService(/** @type {string} */ id) {
  const c = connectors?.get(id);
  if (!c) return t("Buddy doesn't know that service.");
  notice(t("Sign in to {service} in your browser…", { service: t(c.label) }));
  const error = await connectors.connect(id);
  notice(error ? t("Couldn't connect {service}.", { service: t(c.label) }) : t("Connected to {service}.", { service: t(c.label) }));
  settingsWindow?.refresh();
  return error;
}

// ---------- Meeting notes (meeting.js): a transcript of a meeting in any app, then notes written from it ----------

/** @type {ReturnType<typeof setInterval> | undefined} */
let meetingClock;
const meetingFile = () => path.join(app.getPath("userData"), "meeting-in-progress.json");
const writeNotes = (/** @type {string} */ title, /** @type {string} */ markdown) => writeDocx({ title, markdown, dir: documentsDir() });
// The meeting's life (off, starting, on, stopping) is one machine in meeting.js; what Buddy shows follows its state.
// The capture page is made when first needed: its session can only be made once the app is ready.
/** @type {ReturnType<typeof createMeetingCapture> | null} */
let meetingCapture = null;
const capture = () => (meetingCapture ??= createMeetingCapture({ here, onPiece: (p) => meetings.notes()?.piece(p), onEvent: (e) => meetingSound(e), trace }));
/** The sides Buddy hears in the meeting now. @type {Set<"you" | "others">} */
const hearing = new Set();
const sideName = (/** @type {"you" | "others"} */ who) => (who === "you" ? t("your microphone") : t("the PC's sound"));

/**
 * A side's sound ended or came back, or the meeting page crashed. A crashed page is opened again; a side that stays
 * gone is said; when Buddy can hear nothing at all, it stops and writes up what it heard, rather than sit there "on".
 * @param {import("./meeting-capture.js").CaptureEvent} e
 */
async function meetingSound(e) {
  if (meetings.state !== "on") return;
  if ("page" in e) {
    const r = await meetings.reopen();
    if (r.error === "off") return;
    if (r.error) return lostTheMeeting();
    hearing.clear();
    if (r.you) hearing.add("you");
    if (r.others) hearing.add("others");
    trace({ kind: "meeting-reopened", you: !!r.you, others: !!r.others });
    checkMic(r.mic);
    return;
  }
  if (e.back) hearing.add(e.who);
  if (e.who === "you" && (e.back || e.switched)) checkMic(e.mic);
  if (!e.gone) return;
  hearing.delete(e.who);
  if (!hearing.size) return lostTheMeeting();
  const other = e.who === "you" ? "others" : "you";
  notice(t("Buddy can't hear {side} any more; still taking notes from {other}.", { side: sideName(e.who), other: sideName(other) }));
}

/** Whether this meeting has said its microphone is call quality (once is enough). */
let saidCallQuality = false;

/**
 * A Bluetooth headset's microphone in its call mode sends rougher sound: the user's own words come out worse. Said
 * once per meeting, with what helps; Buddy doesn't switch microphones itself, as the headset may be the only one
 * near the user.
 * @param {import("./meeting-capture.js").MicInfo | undefined} mic
 */
function checkMic(mic) {
  if (saidCallQuality || !callQualityMic(mic)) return;
  saidCallQuality = true;
  trace({ kind: "meeting-call-quality-mic", label: mic?.label, rate: mic?.rate });
  notice(t("Your headset's microphone is in call mode, so your words may come out rougher. Your PC's own microphone gives a cleaner transcript."));
}

async function lostTheMeeting() {
  trace({ kind: "meeting-lost" });
  notice(t("Buddy stopped hearing the meeting, so it's writing up what it heard."));
  await stopMeetingNotes();
}
const meetings = createMeetingSession({
  capture: { start: (o) => capture().start(o), stop: () => capture().stop(), close: () => capture().close() },
  makeNotes: () => createMeetingNotes({
    transcribe: (pcm) => voice?.transcribe(pcm) ?? Promise.resolve({ error: "no voice" }),
    complete: (system, text) => {
      if (!brain) throw new Error(t("No AI is set up, so only the transcript was saved."));
      return brain.complete(system, text);
    },
    write: writeNotes,
    progressFile: meetingFile(),
    trace,
  }),
  onState: (state) => {
    // Buddy's voice stays quiet from the moment a meeting starts until its notes are written (sound.js).
    voice?.setMeeting(state !== "off");
    clearInterval(meetingClock);
    islandFacts.meeting = null;
    if (state === "on") {
      showMeetingLine();
      meetingClock = setInterval(showMeetingLine, 30_000);
    }
    if (state === "stopping") notice(t("Writing up the meeting notes…"));
    buildTrayMenu();
    showIsland();
  },
});
/** Whether a meeting is being taken, from starting until its notes are written: Buddy stays quiet throughout. */
const meetingOn = () => meetings.state !== "off";

/** The island's line while notes are being taken: how long so far. */
function showMeetingLine() {
  const m = meetings.notes();
  if (meetings.state !== "on" || !m) return;
  const minutes = Math.floor((Date.now() - m.started.getTime()) / 60000);
  islandFacts.meeting = minutes < 1 ? t("Taking notes") : t("Taking notes · {n} min", { n: minutes });
  showIsland();
}

/**
 * Starts taking notes of a meeting, in whatever app it's in: the microphone and the PC's sound, transcribed on the PC.
 * Buddy stays quiet meanwhile (its voice would be in the transcript). Resolves what it could hear, or an error in words.
 * @param {{ testMic?: Uint8Array, testMicInfo?: { label: string, rate: number } }} [o] testMic: a recording played as the microphone, and the device it stands in for (end-to-end check)
 * @returns {Promise<{ you?: boolean, others?: boolean, error?: string }>}
 */
async function startMeetingNotes({ testMic, testMicInfo } = {}) {
  if (!voice) return { error: t("Buddy's listening isn't available, so it can't take notes.") };
  if (meetings.state === "stopping") return { error: t("Buddy is still writing up the last meeting's notes.") };
  if (meetingOn()) return { error: t("Buddy is already taking notes.") };
  hushReply();
  const r = await meetings.start({ testMic, testMicInfo });
  if (r.error === "busy") return { error: t("Buddy is already taking notes.") };
  if (r.error) return { error: t("Buddy couldn't hear the meeting: neither the microphone nor the PC's sound would open.") };
  hearing.clear();
  if (r.you) hearing.add("you");
  if (r.others) hearing.add("others");
  trace({ kind: "meeting-started", you: !!r.you, others: !!r.others });
  saidCallQuality = false;
  checkMic(r.mic);
  return { you: !!r.you, others: !!r.others };
}

/**
 * Stops taking notes: the last words are transcribed, the user's AI writes the notes, and the document (notes, then
 * the whole transcript) is saved in Documents › Buddy and opened. Resolves the document, or an error in words.
 * @returns {Promise<{ file?: string, problem?: string | null, error?: string }>}
 */
async function stopMeetingNotes() {
  const done = await meetings.stop();
  if (done.error === "off") return { error: t("Buddy isn't taking notes.") };
  if (done.error || !done.file) {
    trace({ kind: "meeting-stop-failed", why: String(done.error).slice(0, 200) });
    notice(t("Couldn't save the meeting notes"));
    return { error: done.error ?? "no document" };
  }
  recordChange({ kind: "document", summary: t("Wrote meeting notes"), file: done.file, from: "Buddy" });
  notice(done.problem ? t("Meeting transcript saved (no notes: {why})", { why: done.problem }) : t("Meeting notes saved"));
  revealMade([done.file]);
  return { file: done.file, problem: done.problem };
}

// What the bubble's Brain may do with meeting notes (its meeting_notes tool).
const meetingUI = { on: () => meetings.state === "on", start: () => startMeetingNotes(), stop: () => stopMeetingNotes(), transcript: () => meetings.notes()?.text() ?? "" };

/** @type {ReturnType<typeof createLessons> | null} "teach me this app" lessons, kept on the PC (lessons.js) */
let lessons = null;
/** @type {{ title: string, app: string, steps: any[] } | null} the route the bubble's last answer finished, offered as a lesson */
let routeToKeep = null;
/** A new conversation in the bubble: the old one is forgotten, here and on the PC. */
function resetBubble() {
  brain?.reset();
  conversations?.forget("bubble");
}
const startLedger = () => (ledger = createLedger({ file: path.join(app.getPath("userData"), "spend.json") }));

// Every Brain gets these: each model call is added to the month (tasks and routines count too), and the limit is
// checked before each one. `spend.now` is the answer in progress, for the bubble's footer.
const spendUI = () => {
  const spend = { now: noSpend() };
  return {
    spend,
    usage: (/** @type {string} */ provider, /** @type {string} */ model, /** @type {any} */ usage) => {
      addCall(spend.now, provider, model, usage);
      ledger?.add(addCall(noSpend(), provider, model, usage));
      settingsWindow?.refresh();
    },
    mayCall: () => (ledger ? capProblem(ledger.month(), settings.monthlyCap) : null),
  };
};

/** What Settings › AI & privacy says about spending: the month so far, and what the estimate rests on. */
function spendState() {
  const m = ledger?.month() ?? { cost: 0, tokens: 0, calls: 0, unpriced: 0 };
  const provider = currentProvider();
  const label = PROVIDERS[provider].label;
  const model = provider === "anthropic" ? settings.model : settings.providerModels[provider] ?? "";
  const price = priceOf(provider, model);
  const spent = m.cost > 0 ? aboutMoney(m.cost) : t("nothing priced");
  const month = !m.calls ? t("Nothing spent this month yet.")
    : m.calls === 1 ? t("This month so far: {spent}, {tokens} tokens over 1 model call.", { spent, tokens: tokenWords(m.tokens) })
    : t("This month so far: {spent}, {tokens} tokens over {n} model calls.", { spent, tokens: tokenWords(m.tokens), n: m.calls });
  const basis =
    price === "free" ? t("{provider} runs on this PC, so it costs nothing.", { provider: label })
    : price ? t("Costs are estimates from {provider}'s published prices; your bill is what {provider} charges.", { provider: label })
    : t("Buddy doesn't know {provider}'s price for this model, so its use shows as tokens only and doesn't count toward a limit.", { provider: label });
  const unpriced = !m.unpriced ? "" : m.unpriced === 1 ? ` ${t("1 call this month had no known price.")}` : ` ${t("{n} calls this month had no known price.", { n: m.unpriced })}`;
  const cap = settings.monthlyCap > 0 ? ` ${t("Buddy stops when this month's priced spend reaches {limit}.", { limit: moneyWords(settings.monthlyCap) })}` : "";
  return { month, note: `${basis}${unpriced}${cap}` };
}

// Shows the user what an answer made: one file opens in its usual app, several open their folder with one selected.
async function revealMade(/** @type {string[]} */ files) {
  const there = files.filter((f) => fs.existsSync(f));
  if (!there.length) return;
  // End-to-end checks (BUDDY_E2E) say what would open instead of opening windows over the user's work.
  if (process.env.BUDDY_E2E) return console.log("REVEALED", JSON.stringify(there));
  if (there.length > 1) return shell.showItemInFolder(there.at(-1) ?? there[0]);
  const error = await shell.openPath(there[0]);
  if (error) shell.showItemInFolder(there[0]);
  trace({ kind: "revealed", files: there.length, error: error || null });
}

const recordChange = (/** @type {Omit<import("./activity.js").Change, "id" | "at">} */ change) => {
  activity?.add(change);
  trace({ kind: "activity", what: change.kind });
};

// ---------- Overlay: one transparent, click-through window per display ----------

function createOverlays() {
  annotationLayer.clear();
  for (const win of overlays.values()) win.destroy();
  overlays.clear();
  for (const display of screen.getAllDisplays()) {
    const win = new BrowserWindow({
      ...display.bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setIgnoreMouseEvents(true);
    win.loadFile(path.join(here, "ui/overlay.html"));
    win.once("ready-to-show", () => {
      win.showInactive();
      win.setBounds(display.bounds); // Windows clamps oversized windows to the work area on create
    });
    overlays.set(display.id, win);
  }
  island?.moveTop();
}

/** @param {DipPoint} point */
function overlayFor(point) {
  const display = screen.getDisplayNearestPoint(point);
  return { win: overlays.get(display.id), origin: display.bounds };
}

function broadcast(channel, payload) {
  for (const win of overlays.values()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

// Buddy's pointer follows the cursor, checking it 60 times a second while the mouse moves; once the mouse has been
// still for a moment, 20 a second is plenty to notice it moving again, and costs a third as much.
const CURSOR_FAST_MS = 16;
const CURSOR_SLOW_MS = 50;
const CURSOR_SETTLE_MS = 500;

function trackCursor() {
  let last = "";
  let movedAt = 0;
  const inside = new Map(); // overlay display id -> whether the cursor was on that display last time
  const tick = () => {
    const p = cursor();
    const key = `${p.x},${p.y}`;
    if (key !== last) {
      last = key;
      movedAt = Date.now();
      const displays = screen.getAllDisplays();
      for (const [id, win] of overlays) {
        const d = displays.find((x) => x.id === id);
        if (!d || win.isDestroyed()) continue;
        const on = p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height;
        // A display the cursor isn't on hears so once, not on every move elsewhere.
        if (on || inside.get(id) !== false) win.webContents.send("cursor", on ? { x: p.x - d.bounds.x, y: p.y - d.bounds.y } : null);
        inside.set(id, on);
      }
    }
    setTimeout(tick, Date.now() - movedAt < CURSOR_SETTLE_MS ? CURSOR_FAST_MS : CURSOR_SLOW_MS);
  };
  tick();
}

/** @param {PhysicalRect} physical */
function toLocalRect(physical) {
  /** @type {DipRect} */
  const dip = toDipRect(physical);
  const center = asDipPoint({ x: dip.x + dip.width / 2, y: dip.y + dip.height / 2 });
  const { win, origin } = overlayFor(center);
  return { win, rect: { x: dip.x - origin.x, y: dip.y - origin.y, width: dip.width, height: dip.height } };
}

// The pointer belongs to whoever pointed last: the bubble's conversation ("bubble") or a task (its id). `n` counts
// points, so a release scheduled when one answer ends can't pull the pointer off a newer step.
const pointer = { owner: null, n: 0, annotation: false };
const annotationLayer = createAnnotationLayer({
  draw: (items, owner) => {
    pointer.owner = owner;
    pointer.annotation = true;
    pointer.n++;
    const first = toLocalRect(items[0].bounds);
    for (const win of overlays.values()) win.webContents.send("release");
    first.win?.webContents.send("point", { rect: first.rect, caption: "", decorate: false });
    for (const display of screen.getAllDisplays()) {
      const local = (box) => { const dip = toDipRect(box); return { ...dip, x: dip.x - display.bounds.x, y: dip.y - display.bounds.y }; };
      const drawings = items.map((item) => ({ ...item, bounds: local(item.bounds), ...(item.to ? { to: local(item.to) } : {}),
        showLabel: insideBox(centerOf(toDipRect(item.bounds)), display.bounds) }));
      overlays.get(display.id)?.webContents.send("annotations", drawings);
    }
  },
  erase: () => {
    broadcast("annotations-clear");
    if (pointer.annotation) { pointer.annotation = false; pointer.owner = null; pointer.n++; broadcast("release"); }
  },
});

async function showAnnotations(items, context, owner = "bubble") {
  let originalBounds = null;
  const reject = (reason, extra = {}) => { trace({ kind: "annotation-hidden", reason, ...extra }); return false; };
  const validate = async () => {
    if (context.signal?.aborted) return false;
    const windows = await listWindows();
    const target = windows.find((w) => w.id === context.window.id && appKey(w.app_name) === appKey(context.window.app_name) && (!context.window.pid || w.pid === context.window.pid));
    if (!target || target.minimized || !target.bounds) return reject("window-unavailable");
    const foreground = windows.find((w) => w.is_focused);
    if (foreground && foreground.id !== target.id && !ownPids().includes(Number(foreground.pid))) return reject("focus-changed", { front: appKey(foreground.app_name) });
    if (originalBounds && !sameBox(originalBounds, target.bounds)) return reject("window-moved");
    originalBounds ??= target.bounds;
    if (items.some((item) => !insideBox(centerOf(item.bounds), target.bounds) || (item.to && !insideBox(centerOf(item.to), target.bounds)))) return reject("anchor-outside-window");
    return (await context.verify()) || reject("anchor-changed");
  };
  const shown = await annotationLayer.show(owner, items, { validate, signal: context.signal });
  if (shown && annotationLayer.owner() !== owner) return false;
  if (shown && owner === "bubble") {
    liveReply.cancel();
    if (mode === "working" && bubble.isVisible() && !waitingForOk()) hideBubble();
    if (context.caption && speaksNow()) voice.say(context.caption);
  }
  return shown;
}

/** @param {PhysicalRect} bounds @param {string} caption @param {string} [owner] @param {{ guess?: boolean }} [how] */
function point(bounds, caption, owner = "bubble", { guess = false } = {}) {
  annotationLayer.clear();
  pointer.annotation = false;
  pointer.owner = owner;
  pointer.n++;
  const { win, rect } = toLocalRect(bounds);
  for (const other of overlays.values()) if (other !== win) other.webContents.send("release");
  win?.webContents.send("point", { rect, caption, guess });
  return new Promise((r) => setTimeout(r, 900));
}

// A best guess from the screenshot, for something with no control to point at (brain.js spotBounds): a soft ring,
// "about here". There is no control to follow, so it's let go as soon as the window it's on moves, changes size,
// is minimized or loses focus, and after GUESS_MS in any case.
const GUESS_MS = 10_000;
/** @param {PhysicalRect} bounds @param {string} caption @param {any} window @param {string} [owner] */
function guessPoint(bounds, caption, window, owner = "bubble") {
  const flying = point(bounds, caption ? `${caption} (about here)` : "About here", owner, { guess: true });
  const n = pointer.n;
  const until = Date.now() + GUESS_MS;
  const check = async () => {
    if (pointer.n !== n || pointer.owner !== owner) return; // it pointed somewhere else meanwhile
    const windows = await listWindows();
    if (pointer.n !== n || pointer.owner !== owner) return;
    const gone = guessGone(window, windows, ownPids());
    if (!gone && Date.now() < until) return setTimeout(check, 700);
    trace({ kind: "guess-cleared", why: gone ?? "timeout" });
    pointer.owner = null;
    pointer.n++;
    broadcast("release");
  };
  setTimeout(check, 1200);
  return flying;
}

// Lets go of the pointer after a moment, if `owner` still has it and hasn't pointed again.
/** @param {string} owner @param {number} [ms] */
function releaseLater(owner, ms = 6000) {
  annotationLayer.release(owner, ms);
  const n = pointer.n;
  setTimeout(() => {
    if (pointer.owner !== owner || pointer.n !== n) return;
    pointer.owner = null;
    broadcast("release");
  }, ms);
}

// ---------- Island: a status pill at the top of the primary display ----------

function createIsland() {
  const { workArea } = screen.getPrimaryDisplay();
  island = new BrowserWindow({
    ...ISLAND,
    x: Math.round(workArea.x + (workArea.width - ISLAND.width) / 2),
    y: workArea.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false },
  });
  island.setAlwaysOnTop(true, "screen-saver");
  island.setIgnoreMouseEvents(true, { forward: true });
  island.loadFile(path.join(here, "ui/island.html"));
  island.once("ready-to-show", () => island.showInactive());
  island.webContents.on("did-finish-load", () => {
    const taken = takenHotkeys();
    if (taken.length) notice(t("{keys} is used by another app: change it in Settings", { keys: taken.map((n) => keyLabel(hotkey(n))).join(", ") }));
    showIsland({ force: true });
    if (tasks) island.webContents.send("tasks", tasks.list());
  });
  island.webContents.on("render-process-gone", () => {
    clearInterval(peekTimer);
    island.destroy();
    createIsland();
  });
}

function islandSlot() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: Math.round(workArea.x + (workArea.width - ISLAND.width) / 2), y: workArea.y, ...ISLAND };
}

// The island is Buddy's "on" light: while Buddy runs it stays on screen. Windows can drop a topmost
// window behind the Start menu, a full-screen app or a display change, so keep putting it back.
function keepIsland() {
  if (!island || island.isDestroyed()) return createIsland();
  const slot = islandSlot();
  const b = island.getBounds();
  if (b.x !== slot.x || b.y !== slot.y || b.width !== slot.width) island.setBounds(slot);
  if (!island.isVisible()) island.showInactive();
  // Re-applying "always on top" is the expensive part of this check, so only when Windows actually dropped it.
  if (!island.isAlwaysOnTop()) island.setAlwaysOnTop(true, "screen-saver");
  island.moveTop();
  // The island only lets clicks through again when its page sees the mouse leave. If that was missed and the
  // cursor is now elsewhere, its transparent area would keep catching clicks meant for the apps beneath it.
  const p = cursor();
  const nb = island.getBounds();
  const inside = p.x >= nb.x && p.x < nb.x + nb.width && p.y >= nb.y && p.y < nb.y + nb.height;
  if (islandHovered && !inside) {
    islandHovered = false;
    island.setIgnoreMouseEvents(true, { forward: true });
    island.webContents.send("island-leave");
  }
}

const keyLabel = (accel) => accel.replace("Control", "Ctrl").replace("CommandOrControl", "Ctrl");

// Redraws the island from the facts. Changes made in the same moment (an answer ending, then its outcome) are drawn
// once, on the next tick, so the island doesn't flicker through the state in between.
let islandPending = false;
function showIsland({ force = false } = {}) {
  if (force) islandShown = "";
  if (islandPending) return;
  islandPending = true;
  setImmediate(() => {
    islandPending = false;
    if (!island || island.isDestroyed()) return;
    const view = islandView({
      mode,
      approval: approvals.current()?.summary ?? null,
      ...islandFacts,
      speaking: !!voice?.speaking,
      saying,
      bubbleOpen: !!bubble && !bubble.isDestroyed() && bubble.isVisible(),
    });
    const message = { ...view, hotkey: keyLabel(hotkey("ask")), talkKey: keyLabel(hotkey("talk")), advanced: settings.advanced };
    const key = JSON.stringify(message);
    if (key === islandShown) return;
    islandShown = key;
    islandState = view.state;
    island.webContents.send("island", message);
  });
}

/** The running activity's latest line ("Reading the page…"). */
function progress(/** @type {string} */ text) {
  islandFacts.progress = text;
  showIsland();
}

/** An outcome to show once the activity is over: the answer, an error, "Typed 12 words". The island fades it. */
function notice(/** @type {string} */ text) {
  islandFacts.notice = text;
  showIsland();
}

const status = (text) => {
  bubble.webContents.send("status", text);
  progress(text);
};

const oneLine = (text) => (text.length > 70 ? `${text.slice(0, 67)}…` : text);

// ---------- Bubble: the prompt + speech window ----------

function createBubble() {
  bubble = new BrowserWindow({
    ...BUBBLE,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false },
  });
  bubble.setAlwaysOnTop(true, "pop-up-menu");
  bubble.loadFile(path.join(here, "ui/bubble.html"));
  // The approval card reports presses on it, so a lost Allow click can be traced to the window or the page.
  bubble.webContents.on("console-message", (e) => {
    if (e.message.startsWith("TRACE ")) trace({ kind: "bubble", note: e.message.slice(6) });
  });
  bubble.on("blur", () => {
    // Out of the bubble and (likely) back in their window: what Buddy glanced at may have changed.
    if (mode !== "working") brain?.staleGlance?.();
    if (mode === "idle") hideBubble();
  });
  // Closing the bubble ends the conversation about what was marked.
  bubble.on("hide", () => {
    if (mode !== "idle") return;
    clearMarks();
    showIsland();
  });
  bubble.on("show", () => {
    if (mode === "idle") showIsland();
  });
}

// The bubble always hangs from the island, so the chat reads as the island opening up.
function placeBubble() {
  const slot = islandSlot();
  bubble.setBounds({ x: Math.round(slot.x + slot.width / 2 - BUBBLE.width / 2), y: slot.y, ...BUBBLE });
}

function showBubble({ focus = true } = {}) {
  clearTimeout(bubbleHideTimer);
  if (!bubble.isVisible()) placeBubble();
  if (focus) {
    bubble.show();
    bubble.focus();
  } else {
    bubble.showInactive();
  }
  // All topmost windows share one band on Windows, so focusing the bubble lifts it over the island; the
  // folded card has to stay under the pill it slides out of.
  if (island && !island.isDestroyed()) island.moveTop();
  bubble.webContents.send("bubble-open");
  island?.webContents.send("island-attach", true);
}

// Closing plays the bubble back into the island first; `now` skips that when the screen is about to be captured.
function hideBubble({ now = false } = {}) {
  clearTimeout(bubbleHideTimer);
  if (!bubble.isVisible()) return;
  bubble.webContents.send("bubble-close");
  island?.webContents.send("island-attach", false);
  if (now) bubble.hide();
  else bubbleHideTimer = setTimeout(() => bubble.hide(), BUBBLE_FOLD_MS);
}


// The main hotkey switches Buddy between idle and active: it opens the bubble, or closes it if it's open.
function toggle() {
  if (bubble.isVisible() && (mode === "idle" || mode === "listening")) {
    voice?.cancelListening();
    return hideBubble();
  }
  summon();
}

// Hand focus back to the user's app while we work, so keyboard actions land there.
// It only steps back (blur): it never switches itself to "can't take focus". On Windows, setFocusable(false) on a
// bubble that has been hidden and shown again leaves it deaf to every click, so an approval card or Stop can't be
// pressed (reproduced with real clicks). Clicking the card activates the bubble, so answering it hands the keyboard
// back again (answerApproval).
function releaseFocus() {
  bubble.blur();
  // Stepping back doesn't give the keyboard to another app on Windows, so hand it to the window the user was in.
  if (about.window) takeTurn(() => perform(returnFocus(about.window))).catch(() => {});
}

async function summon() {
  if (mode === "working" || mode === "reading-marks") return showBubble({ focus: false });
  if (Date.now() - turn.at > IDLE_RESET_MS) resetBubble();
  // The window the user is in: the focused one, or, when Buddy itself has the focus (its bubble was just closed), the
  // frontmost window that isn't Buddy's, which is where they'll be once it's gone. Without one, the keyboard couldn't
  // be handed back after an approval (releaseFocus).
  const own = ownPids();
  const win = (await foregroundWindow(own)) ?? (await listWindows()).find((w) => !own.includes(w.pid)) ?? null;
  about = { window: win, point: cursor() };
  brain?.glance(win);
  bubble.webContents.send("summon", {
    target: win ? `${win.app_name} — ${win.title}` : null,
    needsKey: !brain,
    tip: tourTipNow(),
    voiceOffer: voiceOfferNow(),
    advanced: settings.advanced,
    // The lessons for the app they're in, one click away (lessons.js).
    shelf: win && lessons ? { app: appName(win.app_name), ...lessonsFor(lessons.list(), win.app_name) } : null,
  });
  showBubble();
  offerConnection(win);
}

// ---------- Explain: capture around a point, ask the brain, show an infographic ----------

// The whole display as an image, with Buddy's own pointer hidden.
async function grabDisplay(display, signal = undefined, getSources = (options) => desktopCapturer.getSources(options)) {
  if (signal?.aborted) throw signal.reason;
  const sf = display.scaleFactor;
  const size = { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) };
  if (++displayCaptures === 1) broadcast("hide-buddy", true);
  try {
    await abortable(() => new Promise((r) => setTimeout(r, 60)), signal);
    const sources = await abortable(() => getSources({ types: ["screen"], thumbnailSize: size }), signal);
    const source = sources.find((s) => s.display_id === String(display.id));
    if (!source) throw new Error("This display isn't available for capture. Try again.");
    return source.thumbnail;
  } finally {
    if (--displayCaptures === 0) broadcast("hide-buddy", false);
  }
}

/** @param {DipPoint} dipPoint */
async function captureAround(dipPoint) {
  const display = screen.getDisplayNearestPoint(dipPoint);
  const sf = display.scaleFactor;
  {
    const shot = await grabDisplay(display);
    const { width: W, height: H } = shot.getSize();
    const local = { x: Math.round((dipPoint.x - display.bounds.x) * sf), y: Math.round((dipPoint.y - display.bounds.y) * sf) };
    const cw = Math.min(CROP.width, W);
    const ch = Math.min(CROP.height, H);
    const rect = {
      x: Math.min(Math.max(local.x - cw / 2, 0), W - cw),
      y: Math.min(Math.max(local.y - ch / 2, 0), H - ch),
      width: cw,
      height: ch,
    };
    const crop = shot.crop(rect);
    return { image: crop.toPNG().toString("base64"), tip: { x: local.x - rect.x, y: local.y - rect.y } };
  }
}

/** @param {DipPoint} dipPoint @param {string} [question] */
function explainAt(dipPoint, question) {
  if (mode !== "idle") return;
  if (!brain) return summon();
  enter("working");
  return runExplain(dipPoint, question);
}

// Expects mode "working", set by the caller.
/** @param {DipPoint} dipPoint @param {string} [question] */
async function runExplain(dipPoint, question) {
  startTurn();
  progress(t("Looking at that…"));
  try {
    const physical = toPhysicalPoint(dipPoint);
    const [win, shot] = await Promise.all([windowAt(physical, ownPids()), captureAround(dipPoint)]);
    about = { window: win, point: dipPoint };
    const element = await elementAt(win, physical);
    const reply = await brain.explain({ ...shot, element, target: win, question });
    if (turn.explainerShown) {
      notice(oneLine(reply));
    } else {
      notice(t("Answered"));
      bubble.webContents.send("status", "");
      bubble.webContents.send("reply", reply);
      showBubble({ focus: false });
    }
  } catch (err) {
    notice(t("Couldn't explain that: {why}", { why: err.message }));
  } finally {
    enter("idle");
    releaseLater("bubble");
  }
}

// ---------- Marker (marker.js): highlight things on screen with a pen, then ask about them ----------

const marker = createMarker({
  here,
  mode: () => mode,
  enter,
  ready: () => !!brain,
  summon: () => summon(),
  marked: () => tourEvent("marked"),
  hideBubble: () => hideBubble({ now: true }),
  showAsk: (where, list) => {
    about = where;
    const win = about.window;
    bubble.webContents.send("summon", { target: win ? win.app_name + " — " + win.title : null, needsKey: !brain });
    bubble.webContents.send("marks", list);
    showBubble();
    showIsland();
  },
  progress: (text) => progress(text),
  notice: (text) => notice(text),
  keepIsland: () => keepIsland(),
  grabDisplay: (display, signal) => grabDisplay(display, signal),
  cursor,
  overlay: (id) => overlays.get(id),
  cleared: () => {
    broadcast("marks-clear");
    brain?.marks?.clear();
  },
  toPhysicalPoint,
  toPhysicalRect,
  ownPids,
  explain: (at) => runExplain(at),
  trace: (entry) => trace(entry),
  // Live marking (marker-live.js): the overlay, built once into Buddy's data folder, over the display's physical pixels.
  // A test copy can make it fail, to check the still takes over.
  live: async (display, onEvent) => {
    if (process.env.BUDDY_E2E && process.env.BUDDY_MARK_LIVE_FAIL) throw new Error("live marking turned off for this check");
    const exe = await overlayProgram({ cacheDir: path.join(app.getPath("userData"), "native") });
    return startOverlay(exe, toPhysicalRect(asDipRect(display.bounds)), { scale: display.scaleFactor, color: ACCENTS[settings.accent].hex, onEvent });
  },
  toDipPoint,
  markKey: () => keyLabel(hotkey("mark")),
});
const { start: startMarking, stop: stopMarkMode, clear: clearMarks, cancel: cancelMarking } = marker;

// Each window's messages are taken only from that window: every Buddy page shares one preload (and so could call any
// of them), but only the bubble answers its approval card or asks a question, only the island acts for the island.
// A message from anywhere else is refused and logged; it would mean a page was made to do what it never does.
const fromBubble = (/** @type {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} */ e) => !!bubble && !bubble.isDestroyed() && e.sender === bubble.webContents;
const fromIsland = (/** @type {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} */ e) => !!island && !island.isDestroyed() && e.sender === island.webContents;
/** @param {(e: any) => boolean} check @param {string} channel @param {(e: Electron.IpcMainEvent, ...args: any[]) => void} fn */
function onFrom(check, channel, fn) {
  ipcMain.on(channel, (e, ...args) => (check(e) ? fn(e, ...args) : trace({ kind: "refused-ipc", channel })));
}
/** @param {(e: any) => boolean} check @param {string} channel @param {(e: Electron.IpcMainInvokeEvent, ...args: any[]) => any} fn */
function handleFrom(check, channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (check(e)) return fn(e, ...args);
    trace({ kind: "refused-ipc", channel });
    throw new Error(`${channel} isn't taken from this window`);
  });
}
// Explainer plates open in a window of their own (explainer-window.js), beside where the user was looking.
/** @param {any} plate @param {{ near?: DipPoint, observed?: { app_name?: string } | null }} [where] */
const openExplainer = (plate, { near = cursor(), observed = null } = {}) => openPlate(plate, { near, observed, dir: explainersDir(), icon: ICON });

// ---------- IPC ----------

handleFrom(fromBubble, "ask", async (_e, text, opts = {}) => {
  if (typeof text !== "string" || !text.trim()) return { reply: null };
  if (!["idle", "working", "listening"].includes(mode)) return { reply: t(BUSY[mode]) };
  return bubbleTurns.run((isCurrent) => answerQuestion(text, opts, isCurrent));
});

async function answerQuestion(text, opts, isCurrent) {
  if (!brain) return { reply: "Choose how I think first, in Settings › AI & privacy: an API key (Anthropic, OpenAI, OpenRouter, Gemini, DeepSeek), or a free model on this PC with Ollama or LM Studio. Or ask me from the AI app you already use (Claude, Codex, Gemini, Copilot): Use with your AI app, in the same place." };
  // Typed while the mic was open: the typing wins.
  if (mode === "listening") voice.cancelListening();
  else if (mode !== "idle") return { reply: t(BUSY[mode]) };
  enter("working");
  // "Talking is ready" (or why it isn't) has been read by now; the tour's tip can have the space back.
  if (voiceFetched) {
    voiceFetched = null;
    sendVoiceOffer();
  }
  const engine = brain;
  answeringBrain = engine;
  startTurn({ spoken: !!opts?.spoken, lang: opts?.spoken ? heardLang : "en" });
  const heard = turn.spoken ? heardTiming : null;
  heardTiming = null;
  const clock = questionTiming({ write: trace, voice: turn.spoken, at: heard?.at, heardMs: heard?.heardMs, provider: engine.provider, model: engine.model });
  questionClock = clock;
  hushReply();
  replyMuted = false;
  releaseFocus();
  progress(t("Thinking…"));
  let reply;
  const tally = engine.ui.spend;
  if (tally) tally.now = noSpend();
  try {
    const withMarks = marker.takePending();
    const how = { spoken: turn.spoken, lang: turn.lang, timing: clock, showOff: !!opts?.showOff };
    reply = withMarks ? await engine.askWithMarks(text, withMarks, how) : await engine.ask(text, about.window, how);
  } catch (err) {
    hushReply();
    notice(t("Something broke"));
    return { reply: `Something broke: ${err.message}` };
  } finally {
    answeringBrain = null;
    enter("idle");
    releaseLater("bubble");
    // Kept on the PC, so a restart within the next few minutes picks the conversation up (conversations.js).
    if (engine === brain) conversations?.save({ id: "bubble", n: 0, title: "", target: null, transcript: engine.transcript() });
    clock.finish({ waitForAudio: speaksNow() });
  }
  if (!isCurrent()) return { reply: null, superseded: true };
  notice(oneLine(reply));
  tourEvent("answered");
  // After the mode is back to idle, so the island shows Buddy speaking (and a click stops it).
  if (!liveReply.covers(reply)) {
    liveReply.cancel();
    if (speaksNow()) speak(reply);
  }
  // A route they went all the way through can be kept as a lesson; the bubble offers it, and main keeps the steps.
  routeToKeep = engine.lastRoute ? { title: text, ...engine.lastRoute } : null;
  return { reply, spend: tally ? spendLine(tally.now) : null, lesson: !!routeToKeep };
}

handleFrom(fromBubble, "set-key", async (_e, key) => {
  const error = await setApiKey(String(key ?? ""));
  if (!error && brain) tourEvent("setup");
  return { ok: !error && !!brain, error };
});

// The bubble's answer to offering a connection: connect, not now, or don't ask again for that service.
handleFrom(fromBubble, "connect-offer-answer", async (_e, id, answer) => {
  const c = connectors?.get(String(id));
  if (!c) return null;
  trace({ kind: "connector-answer", id: c.id, answer: String(answer) });
  if (answer === "never") changeSettings({ connectionsDeclined: [...settings.connectionsDeclined, c.id] });
  if (answer !== "yes") return null;
  const error = await connectService(c.id);
  return { state: "done", text: error ?? t("Connected. Ask me to use {service} whenever you like.", { service: t(c.label) }) };
});

// ---------- Lessons (lessons.js): a finished route kept, to play again or share ----------

// The bubble's "Save as a lesson": the route its last answer finished. The steps never come from the page.
handleFrom(fromBubble, "save-lesson", () => {
  if (!routeToKeep || !lessons) return { error: "There's no finished route to keep." };
  const saved = lessons.add(routeToKeep);
  if ("error" in saved) return saved;
  routeToKeep = null;
  trace({ kind: "lesson-saved", steps: saved.lesson.steps.length });
  buildTrayMenu();
  settingsWindow.refresh();
  return { title: saved.lesson.title };
});

/** @type {Brain | null} the Brain playing a lesson: Stop cancels it */
let lessonBrain = null;

/**
 * Plays a lesson in its app's window (the one in front, when several are open; `window` names one): Buddy points at
 * each step and follows the user, with no model call. It only points, so a lesson someone shared can't do anything on
 * this PC.
 */
async function playLesson(/** @type {string} */ id, { window = null } = {}) {
  const lesson = lessons?.get(id);
  if (!lesson) return notice(t("That lesson is gone."));
  if (mode !== "idle") return progress(t(BUSY[mode]));
  const own = ownPids();
  const open = (await listWindows()).filter((w) => !own.includes(w.pid) && String(w.app_name).toLowerCase() === lesson.app.toLowerCase());
  const win = (window && open.find((w) => w.id === window.id)) ?? open.find((w) => w.is_focused) ?? open[0];
  if (!win) return notice(t("Open {app} first, then play the lesson again.", { app: appName(lesson.app) }));
  return playFrom(lesson, 0, win);
}

/**
 * The saved lesson that stopped at a step whose control couldn't be told, for "Fix this step": which lesson, which
 * step, and the window it was playing in. Cleared when anything else is played or the fix is made.
 * @type {{ id: string, index: number, window: any } | null}
 */
let lessonStuck = null;

/** Plays a saved lesson from step `index` and says how it went; one that stopped at a step it couldn't find offers a fix. */
async function playFrom(/** @type {import("./lessons.js").Lesson} */ lesson, /** @type {number} */ index, /** @type {any} */ win) {
  lessonStuck = null;
  const said = await playSteps({ title: lesson.title, steps: lesson.steps.slice(index) }, win);
  if (said.fixable == null) {
    notice(said.text);
    return said;
  }
  lessonStuck = { id: lesson.id, index: index + said.fixable, window: win };
  trace({ kind: "lesson-stuck", step: lessonStuck.index + 1 });
  await summon();
  bubble.webContents.send("repair-offer", { text: said.text.replace(/ Ask Buddy to finish from here[.]$/, ""), canFix: !!brain });
  return said;
}

/**
 * "Fix this step": the step's control is called something else now. Buddy reads the window's controls, asks the AI
 * which one the step means (it can only answer with one of them), checks that one is there and unmistakable, keeps
 * the step aimed at it, and plays on from there. Like any question, it sends the window's control names to the AI.
 */
async function repairLesson() {
  const stuck = lessonStuck;
  lessonStuck = null;
  const lesson = stuck && lessons?.get(stuck.id);
  if (!stuck || !lesson) return notice(t("That lesson is gone."));
  if (!brain) return notice(t("Fixing a step needs an AI: pick a way in first."));
  if (mode !== "idle") return progress(t(BUSY[mode]));
  const step = lesson.steps[stuck.index];
  hideBubble({ now: true });
  enter("working");
  progress(t("Finding step {n} in {app}…", { n: stuck.index + 1, app: appName(lesson.app) }));
  /** @type {string} */
  let problem = "";
  let fixed = null;
  try {
    const res = await snapshotResilient(["--window-id", stuck.window.id], GUIDE_SNAPSHOT, { timeoutMs: 20_000 });
    if (!res.ok) throw new Error(t("Buddy couldn't read the window."));
    const controls = namedControls(res.data.tree);
    const pick = parsePick(await brain.complete(REPAIR_SYSTEM, repairQuestion(step, controls, lesson.app), { maxTokens: 300 }), controls.length);
    const control = pick == null ? null : controls[pick];
    const found = control && findControl(res.data.tree, control.name, control.role);
    const next = control && found?.node ? repairedStep(step, control) : null;
    if (!control) problem = t("Your AI didn't find a control in the window that fits that step.");
    else if (!found?.node) problem = t("There's more than one \"{name}\" in the window, so the step can't point at one.", { name: control.name });
    else if (!next) problem = t("That isn't a step Buddy can play.");
    else {
      const kept = lessons.updateStep(lesson.id, stuck.index, next);
      if ("error" in kept) {
        problem = kept.error;
        lessonStuck = stuck;
      }
      else fixed = { lesson: kept.lesson, name: control.name };
    }
  } catch (err) {
    problem = String(err?.message ?? err);
  } finally {
    enter("idle");
  }
  trace({ kind: "lesson-repair", step: stuck.index + 1, fixed: !!fixed });
  if (!fixed) {
    const text = t("Couldn't fix step {n}: {why}", { n: stuck.index + 1, why: problem });
    if (lessonStuck === stuck) {
      await summon();
      bubble.webContents.send("repair-offer", { text, canFix: true });
    }
    return notice(text);
  }
  settingsWindow?.refresh();
  progress(t("Step {n} now points at \"{name}\". Playing on from there.", { n: stuck.index + 1, name: fixed.name }));
  return playFrom(fixed.lesson, stuck.index, stuck.window);
}

/**
 * Plays a lesson's steps in `win`: Buddy points at each and follows the user, with no model call and no key.
 * @param {{ title: string, steps: readonly import("./lessons.js").Step[] }} lesson @param {any} win
 * @returns {Promise<{ done: boolean, text: string, fixable?: number }>}
 */
async function playSteps(lesson, win) {
  enter("working");
  hideBubble({ now: true });
  progress(t("Lesson: {title}", { title: lesson.title }));
  trace({ kind: "lesson-play", steps: lesson.steps.length });
  lessonBrain = new Brain({
    point: (bounds, caption) => point(bounds, caption),
    annotate: (items, context) => showAnnotations(items, context),
    clearAnnotations: (ms = 0) => annotationLayer.release("bubble", ms),
    // A lesson never acts; were anything to ask, the answer is no.
    confirm: async () => "deny",
    status,
    trace,
    isOwnWindow: (w) => ownPids().includes(Number(w.pid)),
  });
  answeringBrain = lessonBrain;
  const clock = questionTiming({ write: trace, provider: "local", model: "saved-lesson" });
  clock.attempt();
  lessonBrain.timing = clock;
  let said;
  try {
    said = await lessonBrain.playLesson([...lesson.steps], win);
  } catch (error) {
    clock.outcome("error");
    throw error;
  } finally {
    if (lessonBrain.abort?.signal.aborted) clock.outcome("cancelled");
    clock.finish();
    answeringBrain = null;
    lessonBrain = null;
    enter("idle");
    releaseLater("bubble");
  }
  trace({ kind: "lesson-played", done: said.done, said: said.text.slice(0, 200) });
  return said;
}

// ---------- The first minute: Buddy guiding, before any AI is chosen ----------

/** @type {Promise<boolean> | null} */
let hasCalculator = null;
/**
 * Whether Windows' Calculator app is installed for this user. calc.exe is in System32 even where the app isn't
 * (Windows Server, LTSC, some company images), so the app's own registration is what's asked; once, without blocking.
 */
const calculatorInstalled = () => (hasCalculator ??= new Promise((resolve) => {
  execFile("reg", ["query", "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages"], { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(!err && /Microsoft[.]WindowsCalculator_/i.test(String(out))));
}));

/**
 * Whether the starter lesson can be offered: Calculator is installed, and Windows is in English, since Calculator names
 * its controls in Windows' language.
 */
const starterOffered = async () => !!starterStandIn || (process.platform === "win32" && /^en(-|$)/i.test(app.getPreferredSystemLanguages()[0] ?? app.getLocale()) && (await calculatorInstalled()));

// End-to-end checks play the starter in a stand-in window of their own with Calculator's two controls
// (scripts/samples/starter-window.ps1): launching and closing the real one over and over proved unreliable.
const starterStandIn = process.env.BUDDY_E2E ? process.env.BUDDY_STARTER_WINDOW : undefined;
const STAND_IN_TITLE = "Buddy starter sample";

/**
 * "See Buddy in action first", from the welcome: Buddy opens a Calculator window, points the way to Scientific mode
 * and follows the user's clicks, with no AI and no key. Then the welcome comes back, with what's next. The Calculator
 * Buddy opened is left open: it's the user's now, as if they'd opened it.
 */
async function tryStarter() {
  if (mode !== "idle") {
    progress(t(BUSY[mode]));
    return { done: false };
  }
  const started = Date.now();
  const own = ownPids();
  const calculators = async () => (await listWindows()).filter((w) => !own.includes(w.pid) && (starterStandIn ? w.title === STAND_IN_TITLE : appKey(w.app_name) === appKey(STARTER.app)));
  // Always opened afresh, even when one is open: Windows brings a window to the front when the app the user just
  // clicked opens it, and the lesson can only draw over the window in front. One already open behind others would
  // stop the lesson at its first step. If no new window comes (Calculator brought its own forward instead), that one.
  const had = new Set((await calculators()).map((w) => w.id));
  progress(t("Opening Calculator…"));
  try {
    if (starterStandIn) spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", starterStandIn, "-Title", STAND_IN_TITLE], { stdio: "ignore", windowsHide: false });
    else spawn("calc.exe", [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
  } catch {}
  let win = null;
  for (const end = Date.now() + 10_000; !win && Date.now() < end; await new Promise((r) => setTimeout(r, 250))) win = (await calculators()).find((w) => !had.has(w.id)) ?? null;
  if (!win) win = (await calculators()).find((w) => w.is_focused) ?? (await calculators())[0] ?? null;
  if (!win) {
    notice(t("Calculator didn't open. Pick a way in, then ask Buddy about any app."));
    return { done: false };
  }
  // A Calculator just opened shows its window before its buttons can be read; a lesson started then can take the
  // drawing for the user's doing. Wait (a few seconds at most) until the first step's control is there.
  const probe = new Brain({ status() {}, point: async () => {}, confirm: async () => "deny", isOwnWindow: (w) => ownPids().includes(Number(w.pid)) });
  probe.target = win;
  // Readable isn't settled: a window still laying itself out changes from one read to the next, which the lesson would
  // take for the user's doing. So it starts once two reads in a row show the same controls, the first step's among them.
  const first = STARTER.steps[0].target;
  let before = "";
  let settled = false;
  for (const end = Date.now() + 15_000; !settled && Date.now() < end; await new Promise((r) => setTimeout(r, 400))) {
    try {
      probe.labels.clear();
      await probe.look({ app: win.app_name, window_id: win.id }, { windowOnly: true });
      const now = [...probe.labels.values()].sort().join("\n");
      settled = now === before && now.includes(`"${first}"`);
      before = now;
    } catch {}
  }
  trace({ kind: "starter-play", readyMs: Date.now() - started, settled });
  const said = await playSteps({ title: t(STARTER.title), steps: STARTER.steps.map((s) => ({ ...s, caption: t(s.caption) })) }, win);
  notice(said.done ? t("That's Buddy: it points, you click. Pick a way in, and you can ask about any app.") : said.text);
  summon();
  return said;
}

// ---------- The thirty-second tour after setup (welcome.js): ask about the window in front, then Mark once ----------

/** The tip for where the tour is, in the user's own shortcuts and the app they're in. */
const tourTipNow = () => tourTip(/** @type {import("./welcome.js").TourStep} */ (settings.tour), { ask: keyLabel(hotkey("ask")), mark: keyLabel(hotkey("mark")), app: appWords(about.window) });

/** Moves the tour on, and shows the bubble the new tip (or none). */
function tourEvent(/** @type {import("./welcome.js").TourEvent} */ event) {
  const next = tourNext(/** @type {import("./welcome.js").TourStep} */ (settings.tour), event);
  // Setup just finished: offer the voice download too.
  if (event === "setup") sendVoiceOffer();
  if (next === settings.tour) return;
  changeSettings({ tour: next });
  trace({ kind: "tour", step: next, event });
  bubble?.webContents.send("tour", tourTipNow());
}

onFrom(fromBubble, "tour", (_e, event) => {
  if (event === "skip" || event === "gotit") tourEvent(event);
});

// ---------- Voice ready at setup: the one-time download, offered rather than started ----------

/** @type {null | { words: string }} the offered download while it runs: what it's fetching, how far */
let voiceFetch = null;
/** @type {null | "ready" | "failed"} how the offered download ended, shown for a moment */
let voiceFetched = null;
// Whether "Set up talking" started the download: the start-up fetch then has nothing left to do.
let voiceOfferFetched = false;

/** What the bubble's voice offer shows, or null for nothing. */
function voiceOfferNow() {
  if (!voice || !brain) return null;
  if (voiceFetch) return { state: "fetching", text: voiceFetch.words };
  if (voiceFetched === "ready") return { state: "done", text: settings.holdToTalk
    ? t("Talking is ready. Hold {key}, say your question, and let go.", { key: keyLabel(hotkey("ask")) })
    : t("Talking is ready. Press {key} and say your question.", { key: keyLabel(hotkey("talk")) }) };
  if (voiceFetched === "failed") return { state: "done", text: t("I couldn't download my voice just now. I'll try again the first time you talk to me.") };
  if (settings.voiceSetup !== "ask" || voice.installed()) return null;
  return { state: "offer", text: t("Want to talk to me out loud? It needs a one-time download (275 MB, about a minute).") };
}
const sendVoiceOffer = () => bubble?.webContents.send("voice-offer", voiceOfferNow());

/** Download progress from voice.js, while the offered download runs. */
function voiceFetchProgress(/** @type {{ what: string, loaded: number, total: number }} */ info) {
  if (!voiceFetch) return;
  const pct = Math.round((100 * info.loaded) / info.total);
  const words = info.what === "speaking" ? t("Getting my voice ready… {pct}%", { pct }) : t("Getting my ears ready… {pct}%", { pct });
  if (words === voiceFetch.words) return;
  voiceFetch.words = words;
  sendVoiceOffer();
}

onFrom(fromBubble, "voice-offer", async (_e, answer) => {
  if (!voice || voiceFetch) return;
  trace({ kind: "voice-offer", answer });
  if (answer === "no") {
    changeSettings({ voiceSetup: "no" });
    return sendVoiceOffer();
  }
  if (answer !== "yes") return;
  changeSettings({ voiceSetup: "yes" });
  voiceOfferFetched = true;
  voiceFetch = { words: "Getting my voice ready…" };
  sendVoiceOffer();
  try {
    await voice.prepare();
  } catch {}
  voiceFetch = null;
  voiceFetched = voice.installed() ? "ready" : "failed";
  sendVoiceOffer();
  setTimeout(() => {
    voiceFetched = null;
    sendVoiceOffer();
  }, 10_000);
});

// ---------- First-run setup in the bubble (welcome.js): an AI app, a model on this PC, or a key ----------

handleFrom(fromBubble, "welcome-state", async () => ({ ...(await welcomeState(settings.providerURLs)), trial: await starterOffered() }));
// "See Buddy in action first": the starter lesson, before any AI is chosen.
handleFrom(fromBubble, "try-lesson", () => tryStarter().then((r) => ({ done: !!r?.done })));

handleFrom(fromBubble, "welcome-app", async (_e, id) => {
  if (!APP_IDS.includes(id)) return { error: "Buddy doesn't know that app." };
  const error = await setClaude(id, true, "welcome");
  return { error, after: error ? null : t(APPS[id].after), state: await welcomeState(settings.providerURLs) };
});

handleFrom(fromBubble, "welcome-local", async () => {
  const { local } = await welcomeState(settings.providerURLs);
  if (!local.use) return { ok: false, error: local.text };
  changeSettings({ provider: local.use.id });
  const error = await refreshModels(local.use.id);
  // The brain made when the provider changed came before the model was picked; the first question needs this one.
  startBrain();
  if (brain && !error) tourEvent("setup");
  trace({ kind: "welcome-local", provider: local.use.id, ok: !!brain, error });
  return { ok: !!brain && !error, error, label: local.use.label };
});

// Stop or Esc in the bubble. While the bubble's own answer runs, that answer stops (and withdraws its request on the
// card); otherwise the card on show is for an AI app using Buddy, and Stop says no to it.
onFrom(fromBubble, "cancel", () => {
  bubbleTurns.cancel();
  voice?.cancelListening();
  hushReply();
  if (mode === "working") { (answeringBrain ?? brain)?.cancel(); notice(t("Stopped.")); }
  else answerApproval("deny");
  annotationLayer.clear("bubble");
});
onFrom(fromBubble, "reset", () => {
  if (mode === "working") return;
  hushReply();
  resetBubble();
  clearMarks();
});
onFrom(fromBubble, "hide", () => {
  hushReply();
  hideBubble();
});
// The card's answer names the card it was for; one without a card (not a number) answers nothing.
onFrom(fromBubble, "confirm-reply", (_e, decision, id) => {
  trace({ kind: "confirm-reply", decision, waiting: approvals.size() });
  answerApproval(decision, Number.isInteger(id) ? id : -1);
});
let islandHovered = false;
onFrom(fromIsland, "island-hover", (_e, inside) => {
  islandHovered = !!inside;
  island.setIgnoreMouseEvents(!inside, { forward: true });
});
onFrom(fromIsland, "island-action", (_e, action) => {
  const [verb, id] = String(action).split(":");
  if (verb === "ask") summon();
  else if (verb === "settings") settingsWindow.open();
  else if (verb === "mark") startMarking();
  else if (verb === "talk") talkByClick();
  else if (verb === "hush") hushReply();
  else if (verb === "notes-stop") stopMeetingNotes();
  else if (verb === "show") showBubble({ focus: false });
  // The island faded an outcome: it has been seen.
  else if (verb === "settle") {
    islandFacts.notice = null;
    showIsland();
  }
  else if (verb === "task" && !id) newTask();
  else if (verb === "task") tasks.toggle(id);
  else if (verb === "task-open") tasks.open(id);
  else if (verb === "task-allow") tasks.answer(id, "allow");
  else if (verb === "task-deny") tasks.answer(id, "deny");
  else if (verb === "task-close") tasks.close(id);
});

// While the island previews a task, refresh the picture of its window.
let peekTimer = null;
onFrom(fromIsland, "task-peek", (_e, id) => {
  clearInterval(peekTimer);
  peekTimer = null;
  if (!id) return;
  const refresh = async () => {
    const src = await tasks.peek(id);
    if (island && !island.isDestroyed()) island.webContents.send("task-peek", { id, src });
  };
  refresh();
  peekTimer = setInterval(refresh, PEEK_EVERY_MS);
});

// The approval card. Buddy's own chat and the AI apps using Buddy can each be waiting for an OK at once: the card shows
// the oldest; a request whose asker stops (its signal) is withdrawn, and the card moves on or comes down.
/** @type {ReturnType<typeof createApprovalQueue<PhysicalRect>>} */
const approvals = createApprovalQueue({
  show: ({ id, summary, bounds, note, detail }) => {
    trace({ kind: "confirm-shown", bubbleVisible: bubble.isVisible(), focusable: bubble.isFocusable(), bounds: bubble.getBounds(), waiting: approvals?.size() ?? 1 });
    if (bounds) point(bounds, summary);
    showBubble({ focus: false });
    bubble.webContents.send("confirm", { id, summary, note, detail });
    showIsland();
  },
  clear: () => {
    bubble.webContents.send("confirm-clear");
    if (mode === "working") islandFacts.progress = t("Working…");
    showIsland();
  },
  trace,
  // As on the card itself: an answer in the card's first half second is a click that was already on its way.
  armMs: 500,
});
const waitingForOk = () => approvals.size() > 0;

// `summary` says exactly what will happen; `note` is the model's own description, shown smaller under it. `signal` is
// the asker's: when it stops, its request is withdrawn as "deny".
/** @param {string} summary @param {PhysicalRect | null} bounds @param {string} [note] @param {AbortSignal} [signal] @param {string} [detail] @returns {Promise<string>} */
function confirm(summary, bounds, note, signal, detail) {
  return approvals.ask(summary, bounds, note, signal, detail);
}

// The user answered the card (or pressed Esc on it): settles the request it shows.
// `id`: the card answered; without one (Buddy's own "deny", the chat closing) it's the card showing now.
function answerApproval(/** @type {string} */ decision, /** @type {number | undefined} */ id = undefined) {
  if (!approvals.answer(decision, id)) return;
  releaseFocus(); // the click on the card activated the bubble; the user's app gets the keyboard back
}

// When the bubble's own conversation starts guiding, the bubble folds back into the island: the pointer and its
// caption carry the step, and the bubble would otherwise sit over the ribbon or dialog they need to click.
/** @param {PhysicalRect} bounds @param {string} caption @param {any} [guessIn] the window, when it's a best guess (guessPoint) */
function guidePoint(bounds, caption, guessIn = null) {
  liveReply.cancel();
  if (mode === "working" && bubble.isVisible() && !waitingForOk()) hideBubble();
  // In a spoken conversation Buddy says each step as it points, the way a person beside you would.
  if (caption && speaksNow()) voice.say(caption);
  return guessIn ? guessPoint(bounds, caption, guessIn) : point(bounds, caption);
}

// ---------- Voice: talk to Buddy, and hear it talk back ----------

// Talk back: "spoken" (answer aloud when you spoke), "always", or "never".
// Whether Buddy says this answer out loud: the reply, and each guide step's caption. Hush (replyMuted) silences all
// of it until the next question.
const speaksNow = () => !replyMuted && talksBack(turn.spoken);
// Never while taking meeting notes: Buddy's voice would end up in the transcript, and talk over the meeting.
const talksBack = (spoken) => !!voice && !meetingOn() && (settings.talkBack === "always" || (settings.talkBack === "spoken" && spoken));

const HEARD_ERRORS = {
  silence: N("Didn't hear anything"),
  "mic-blocked": N("Microphone blocked: Settings › Privacy › Microphone"),
  "no-mic": N("No microphone found"),
};
/** Why Buddy heard nothing, in words. @param {string} error */
const heardError = (error) => (HEARD_ERRORS[error] ? t(HEARD_ERRORS[error]) : t("Couldn't hear you: {why}", { why: error }));

// The talk hotkey: start listening; pressed again while listening, stop and use what was said. It also cuts
// Buddy off mid-sentence. `press`: the held key this listening follows (hold to talk), or none (a click, a tap of a
// key that can't be watched): only that press's hold and release can keep it open or end it.
async function talk(/** @type {Press | null} */ press = null) {
  if (!voice) return;
  if (mode === "listening") return voice.finishListening();
  if (mode === "working") {
    bubbleTurns.cancel();
    await bubbleTurns.settled();
    // Another hotkey may have taken over while the answer was being cancelled.
    if (currentMode() !== "idle") return;
  }
  const wasSpeaking = voice.speaking;
  hushReply();
  if (mode !== "idle") return wasSpeaking || progress(t(BUSY[mode]));
  if (!brain) return summon();
  enter("listening");
  if (bubble.isVisible()) {
    showBubble();
    // Read their window while they speak, so the answer doesn't wait for it after they finish.
    brain.glance?.(about.window, { keep: true });
  } else await summon();
  bubble.webContents.send("listening", true);
  progress(press?.hold ? t("Listening… let go when you're done") : t("Listening…"));
  const listening = voice.listen();
  if (press) press.listening = true;
  // The key may have been held, or already let go, while the bubble was opening.
  if (press?.hold === "held") voice.holdListening();
  else if (press?.hold === "released") voice.finishListening();
  const { text, error, lang, heardMs, endedAt } = await listening;
  if (press) press.listening = false;
  heardLang = lang ?? "en";
  heardTiming = text && endedAt ? { at: endedAt, heardMs } : null;
  bubble.webContents.send("listening", false);
  // Something else took over meanwhile (they typed the question instead): leave it be.
  if (currentMode() !== "listening") return;
  enter("idle");
  if (text) return bubble.webContents.send("voice-text", text);
  if (error === "cancelled") return showIsland();
  notice(heardError(error));
}

// ---------- Hold to talk: one key, tapped to type or held to talk ----------

// Holding the Ask or Talk shortcut talks to Buddy until it's let go; a tap keeps what each did before (Ask opens or
// closes the bubble, Talk listens until a pause). The keyboard hook that sees the release exists only between the press
// and the release (hold-key.js). Each press carries its own state, handed to the talk() it starts: a press can only
// hold or end the listening it began, never a click's or an earlier press's, and nothing is left behind for the next.
/**
 * @typedef {{ name: string, bubbleWasOpen: boolean, hold: null | "held" | "released", listening: boolean }} Press
 *   hold: held past a tap, then let go; listening: the talk() it started is listening now.
 */
/** @type {import("./hold-key.js").KeyHook} */
let keyHook = uiohookHook();
/** The press being watched for its release. @type {Press | null} */
let pressedKey = null;
const holdKey = createHoldKey({
  hook: { start: (onKeyUp) => keyHook.start(onKeyUp), stop: () => keyHook.stop() },
  // End-to-end checks shorten the wait for a release that never comes.
  releaseTimeoutMs: Number(process.env.BUDDY_E2E && process.env.BUDDY_HOLD_TIMEOUT_MS) || undefined,
  trace,
  onTap: () => {
    const p = pressedKey;
    pressedKey = null;
    if (p?.name === "ask" && p.bubbleWasOpen) toggle();
  },
  onHoldStart: () => {
    const p = pressedKey;
    if (!p) return;
    p.hold = "held";
    if (p.name === "ask") talk(p);
    // Already listening: keep going through pauses. Still opening the bubble: talk() applies it once listening starts.
    else if (p.listening) voice?.holdListening();
  },
  onHoldEnd: ({ timedOut }) => {
    const p = pressedKey;
    pressedKey = null;
    if (!p) return;
    if (timedOut) trace({ kind: "hold-released-late" });
    p.hold = "released";
    // Let go while its listening goes on: that's the end of the question. Let go before listening began (the bubble
    // was still opening): talk() ends it as soon as it starts. A press whose talk() never listened (Buddy was busy)
    // ends nothing.
    if (p.listening) voice?.finishListening();
  },
});

// Talk from a click (the bubble's mic, the island, the tray): no key is held.
const talkByClick = () => talk();

/** A global shortcut fired. @param {import("./settings.js").HotkeyName} name */
function pressHotkey(name) {
  if (!settings.holdToTalk || !voice || (name !== "ask" && name !== "talk")) return HOTKEY_ACTIONS[name]();
  if (holdKey.watching) return; // the key repeating while held
  const bubbleWasOpen = !!bubble?.isVisible();
  /** @type {Press} */
  const press = { name, bubbleWasOpen, hold: null, listening: false };
  pressedKey = press;
  if (!holdKey.pressed(hotkey(name))) {
    pressedKey = null;
    return HOTKEY_ACTIONS[name]();
  }
  // Ask opens the bubble at once (a tap on an open one closes it, on release); Talk starts listening at once.
  if (name === "talk") talk(press);
  else if (!bubbleWasOpen) toggle();
}

// ---------- Dictation: say it, and it's typed where you are ----------

// The dictation key: start; pressed again, stop (and type what's left). It needs no API key: nothing leaves the PC.
async function dictate() {
  if (!voice) return;
  if (mode === "dictating") return voice.finishListening();
  const wasSpeaking = voice.speaking;
  hushReply();
  if (mode !== "idle") return wasSpeaking || progress(t(BUSY[mode]));
  enter("dictating");
  const continuous = settings.dictateStop === "press";
  const key = keyLabel(hotkey("dictate"));
  progress(continuous ? t("Dictating… {key} to stop", { key }) : t("Dictating… pause when you're done"));
  let words = 0;
  const result = await voice.dictate({
    continuous,
    onText: async (text) => {
      await typeText(words ? ` ${text}` : text);
      words += text.split(/\s+/).filter(Boolean).length;
      if (continuous && currentMode() === "dictating") progress(t("Dictating… {n} words · {key} to stop", { n: words, key }));
    },
  });
  enter("idle");
  if (result.pieces) notice(words === 1 ? t("Typed 1 word") : t("Typed {n} words", { n: words }));
  else if (result.error === "cancelled") showIsland();
  else notice(heardError(result.error));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Types dictated text into whatever app has the keyboard: through the clipboard and one paste (Ctrl+V), the way
// dictation tools on Windows do, then puts back what the clipboard held. The paste is the user's own doing, so its
// slip comes from approvals.dictationPaste(), which can only ever paste. It takes its turn with agents' actions.
async function typeText(text) {
  // Electron 45's clipboard is asynchronous and W3C-shaped. Every format on it is copied out first (an item read from
  // the clipboard can still point at it, and the dictated text is about to replace what's there).
  const saved = [];
  for (const item of await clipboard.read().catch(() => [])) {
    const parts = {};
    for (const type of item.types) parts[type] = await item.getType(type).catch(() => null);
    const kept = Object.fromEntries(Object.entries(parts).filter(([, v]) => v != null));
    if (Object.keys(kept).length) saved.push(new ClipboardItem(kept));
  }
  await clipboard.writeText(text);
  const res = await takeTurn(() => perform(dictationPaste()));
  if ("error" in res) trace({ kind: "dictation-paste-failed", error: res.error.code });
  await wait(300); // the app reads the clipboard as it pastes; give it a moment before the old contents go back
  if ((await clipboard.readText()) !== text) return; // the user copied something meanwhile: keep theirs
  if (saved.length) await clipboard.write(saved);
  else clipboard.clear();
}

// Reads a reply aloud; the island shows it while Buddy speaks.
function speak(text) {
  saying = oneLine(text);
  voice.say(text);
}
onFrom(fromBubble, "talk", () => talkByClick());

let downloadSettle = null; // returns the island to rest once download progress stops coming
function onVoiceState(state, info) {
  if (state === "listening" && mode === "listening") progress(t("Listening… pause when you're done"));
  else if (state === "transcribing" && mode === "listening") {
    islandFacts.transcribing = true;
    showIsland();
  } else if (state === "downloading") {
    voiceFetchProgress(/** @type {any} */ (info));
    const pct = Math.round((100 * info.loaded) / info.total);
    islandFacts.download = info.what === "speaking" ? t("Getting Buddy's voice ready… {pct}%", { pct }) : t("Getting Buddy's ears ready… {pct}%", { pct });
    showIsland();
    clearTimeout(downloadSettle);
    downloadSettle = setTimeout(() => {
      islandFacts.download = null;
      showIsland();
    }, 4000);
  } else showIsland(); // speaking or quiet: the island reads voice.speaking
}

function startVoice() {
  voice = createVoice({
    here,
    cacheDir: process.env.BUDDY_MODELS_DIR ?? path.join(app.getPath("userData"), "models"),
    // BUDDY_VOICE (0-9) overrides the voice chosen in Settings.
    // Spoken replies use the language the question was asked in.
    getVoice: () => ({ sid: process.env.BUDDY_VOICE ? Number(process.env.BUDDY_VOICE) : settings.voice, speed: settings.speed, lang: turn.spoken ? turn.lang : "en" }),
    getLanguage: () => settings.language,
    onState: onVoiceState,
    onLevel: (level) => island?.isDestroyed() || island?.webContents.send("voice-level", level),
    onSound: () => questionClock?.audio(),
    trace,
  });
  setTimeout(startupVoiceFetch, 4000);
}

// The models are fetched in the background only when the user said yes (or an older profile, which always did);
// a new profile is asked once setup is done (voiceOfferNow). Already on this PC: prepare only tidies old caches.
// Someone who said yes to the offer before this ran (4 s after start) has started the fetch already: not twice.
function startupVoiceFetch() {
  if (voice && !voiceOfferFetched && (settings.voiceSetup === "yes" || voice.installed())) voice.prepare();
}

// Buddy keeps an eye on its own CPU. Normal use measures at 2-3% of one core (an approval waiting, the pointer
// following the mouse, a step being pointed at), yet one stuck session showed its GPU process at 38% and couldn't be
// reproduced. So when a whole minute averages over CPU_HIGH percent, timing.log records which processes used it and
// what Buddy was doing, and the next heavy moment can be found afterwards.
const CPU_WATCH_MS = 60_000;
const CPU_HIGH = Number(process.env.BUDDY_CPU_HIGH ?? 15); // percent of one core, all processes together; env for checks
function watchCpu() {
  app.getAppMetrics(); // starts the first minute's measurement
  setInterval(() => {
    const byType = {};
    for (const m of app.getAppMetrics()) byType[m.type] = +((byType[m.type] ?? 0) + m.cpu.percentCPUUsage).toFixed(1);
    const total = +Object.values(byType).reduce((a, b) => a + b, 0).toFixed(1);
    if (total > CPU_HIGH) trace({ kind: "cpu-high", total, byType, mode, island: islandState, bubbleOpen: bubble.isVisible(), pointing: !!pointer.owner, tasks: tasks?.count() ?? 0 });
  }, CPU_WATCH_MS);
}

// Timing log (userData/timing.log, JSON lines): how long each model call and tool took, to find slow steps.
/** @type {ReturnType<typeof createLog> | null} */
let timing = null;
function trace(entry) {
  timing ??= createLog(path.join(app.getPath("userData"), "timing.log"));
  timing.write(entry);
}

// Each Brain keeps its snapshots in its own agent-desktop session (brain.js). Those from earlier runs are dead
// weight under ~/.agent-desktop/sessions, so they go at startup; only Buddy's own (buddy-*) are touched.
function clearOldSessions() {
  const root = path.join(process.env.AGENT_DESKTOP_HOME ?? path.join(app.getPath("home"), ".agent-desktop"), "sessions");
  try {
    for (const dir of fs.readdirSync(root)) {
      if (dir.startsWith(SESSION_PREFIX) && !dir.startsWith(`${SESSION_PREFIX}${process.pid}-`)) {
        fs.rmSync(path.join(root, dir), { recursive: true, force: true });
      }
    }
  } catch {}
}

// Where create_document saves, and how it opens the result (Word, or whatever opens .docx here).
// BUDDY_DOCUMENTS_DIR moves it (end-to-end checks keep their files out of the user's Documents).
const documentsDir = () => process.env.BUDDY_DOCUMENTS_DIR ?? path.join(app.getPath("documents"), "Buddy");
// The folders Buddy reads without asking (pc-tools.js): the user's list, or Documents, Desktop and Downloads wherever
// Windows keeps them (OneDrive may hold them).
const usualFolders = () => /** @type {const} */ (["documents", "desktop", "downloads"]).map((n) => app.getPath(n));
const readFolders = () => settings.readFolders ?? usualFolders();
const herePlaces = () => placesHere(documentsDir(), app.getPath("userData"), readFolders());

/** Settings › Agents › Add a folder: the user picks one; a reason it can't be added, or null. @param {BrowserWindow} win */
async function addReadFolder(win) {
  const picked = await dialog.showOpenDialog(win, { title: "Choose a folder Buddy can read without asking", properties: ["openDirectory"] });
  const dir = picked.canceled ? null : picked.filePaths[0];
  if (!dir) return null;
  const problem = grantProblem(dir, herePlaces());
  if (problem) return problem;
  if (readFolders().some((x) => x.toLowerCase() === dir.toLowerCase())) return null;
  return changeSettings({ readFolders: [...readFolders(), dir] }).readFolders ?? null;
}
// Spike: BUDDY_ENGINE=sdk runs conversations on the Claude Agent SDK (src/agent-brain.js).
/** @typedef {import("./providers.js").ProviderId} ProviderId */
// The Agent SDK engine runs Claude Code, so it only works with an Anthropic key.
// Loaded only when asked for: Buddy's own engine does everything for every provider, so installers leave the Agent SDK
// (and the Claude Code program it runs, 346 MB) out. It is an optional dependency: without it, Buddy's own engine runs.
const AgentBrain = process.env.BUDDY_ENGINE === "sdk"
  ? await import("./agent-brain.js").then((m) => m.AgentBrain, (err) => (console.error(`BUDDY_ENGINE=sdk: the Agent SDK isn't installed (${err?.code ?? err}); using Buddy's own engine.`), null))
  : null;
const makeEngine = (ui) => (AgentBrain && currentProvider() === "anthropic" ? new AgentBrain({ ...ui, agentDir: path.join(app.getPath("userData"), "agent") }) : new Brain(ui));
const openFile = (file) => shell.openPath(file);

// The bubble's plates open beside what the user pointed at and say which app it was in.
function bubbleExplain(plate) {
  turn.explainerShown = true;
  openExplainer(plate, { near: about.point ?? cursor(), observed: about.window });
}

// What every Brain is made with for the current provider: its key (empty if it needs none) and where it is.
// Resize in memory before sending, to the size the model will see it at (geometry.js modelPictureSize): detailed
// enough to read a window, without uploading a full-resolution 4K PNG. The size goes with it, for spots measured on it.
function prepareScreenImage(image) {
  const original = nativeImage.createFromBuffer(Buffer.from(image.source.data, "base64"));
  if (original.isEmpty()) throw new Error("Couldn't read the window picture.");
  const { width, height } = original.getSize();
  const size = modelPictureSize(width, height);
  const resized = size.width < width ? original.resize({ ...size, quality: "good" }) : original;
  const sent = /** @type {import("./screen-context.js").ScreenImage} */ ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: resized.toJPEG(82).toString("base64") } });
  return { image: sent, ...resized.getSize() };
}
// One Blender client for every conversation (blender.js). A test copy never reaches the user's own Blender: it talks
// to the test's stand-in, or to a port nothing listens on (port 1), and finds no Blender to open.
const blender = createBlender(process.env.BUDDY_E2E ? { port: Number(process.env.BUDDY_BLENDER_TEST_PORT) || 1, find: () => null } : {});
const providerUI = () => ({ apiKey: loadApiKey() ?? "", provider: currentProvider(), baseURL: providerURL() ?? undefined, commands: () => settings.commands, readFolders, connectors: connectorsUI, blender,
  screenContext: () => settings.screenContext, advanced: () => settings.advanced, prepareImage: prepareScreenImage, ...spendUI() });

function startBrain() {
  brain = providerReady()
    ? makeEngine({ ...providerUI(), meeting: meetingUI, quickModel: () => settings.quickModels[currentProvider()] ?? "", point: guidePoint, pointGuess: (bounds, caption, window) => guidePoint(bounds, caption, window), annotate: (items, context) => showAnnotations(items, context), clearAnnotations: (ms = 0) => annotationLayer.release("bubble", ms), confirm, status, stream: (update) => liveReply.receive(update), explain: bubbleExplain, trace, documentsDir: documentsDir(), dataDir: app.getPath("userData"), record: recordChange, reveal: revealMade, isOwnWindow: (w) => ownPids().includes(Number(w.pid)), openFile })
    : null;
}

// ---------- Use with your AI app: Buddy's tools for the apps people chat in (bridge.js, ai-apps.js) ----------

// Adding Buddy to AI apps, quick chat, repair, and what the welcome offers (ai-app-setup.js).
const { setClaude, openQuickChat, repairClaude, welcomeState } = createAiAppSetup({ trace: (entry) => trace(entry), documentsDir: () => documentsDir() });

// The calls AI apps make (app-bridge.js): each session's Brain draws, points and asks as that session.
const appBridge = createAppBridge({
  dir: app.getPath("userData"),
  ownPids,
  pendingMarks: () => marker.pending(),
  brainUI: (owner, target) => ({
    annotate: (items, context) => showAnnotations(items, context, owner),
    clearAnnotations: (ms = 0) => annotationLayer.release(owner, ms),
    screenContext: () => settings.screenContext,
    point: (bounds, caption) => {
      const shown = point(bounds, caption, owner);
      releaseLater(owner, 60_000);
      return shown;
    },
    pointGuess: (bounds, caption, window) => guessPoint(bounds, caption, window, owner),
    confirm,
    explain: (plate) => openExplainer(plate, { near: cursor(), observed: target() }),
    trace,
    documentsDir: documentsDir(),
    openFile,
    isOwnWindow: (w) => ownPids().includes(Number(w.pid)),
  }),
  status: (text) => {
    islandFacts.appCall = text === null ? null : oneLine(text);
    showIsland();
  },
  notice: (text) => notice(text),
  trace: (entry) => trace(entry),
  // End-to-end checks serve on a pipe of their own (BUDDY_PIPE), so a running Buddy's AI apps never reach a test copy.
  pipe: process.env.BUDDY_E2E ? process.env.BUDDY_PIPE : undefined,
});

// ---------- Tasks: agents with their own windows, tucked into island chips ----------

function startTasks() {
  tasks = createTasks({
    here,
    icon: ICON,
    makeBrain: (ui) => {
      return providerReady() ? makeEngine({ ...providerUI(), trace, documentsDir: documentsDir(), dataDir: app.getPath("userData"), record: recordChange, reveal: revealMade, isOwnWindow: (w) => ownPids().includes(Number(w.pid)), openFile, ...ui }) : null;
    },
    currentTarget: () => foregroundWindow(ownPids()),
    point,
    annotate: showAnnotations,
    clearAnnotations: (owner, ms = 0) => annotationLayer.release(owner, ms),
    release: releaseLater,
    explain: (plate, observed) => openExplainer(plate, { observed }),
    onChange: (list) => {
      if (island && !island.isDestroyed()) island.webContents.send("tasks", list);
    },
    keep: conversations ?? undefined,
    trace,
  });
}

// A fresh task, or (from the bubble) the current conversation moved into its own window so it can keep going
// while the bubble is free for something else.
async function newTask({ fromBubble = false } = {}) {
  if (!brain) return summon();
  if (fromBubble && mode !== "idle") return progress(t("Let Buddy finish this answer, then make it a task"));
  let result;
  if (fromBubble && brain.transcript().length) {
    result = await tasks.create({ brain, target: about.window });
    if (!result.error) {
      startBrain();
      conversations?.forget("bubble"); // it's the task's now
      clearMarks();
      bubble.webContents.send("reply", "");
    }
  } else {
    result = await tasks.create();
  }
  if (result.error) notice(result.error);
  else hideBubble({ now: true });
}
onFrom(fromBubble, "new-task", () => newTask({ fromBubble: true }));

// ---------- Tray ----------

// Icons are generated by scripts/make-icon.js from the same pointer shape the overlay draws.
const ICON = path.join(here, "../assets/buddy.ico");
const trayIcon = () => nativeImage.createFromPath(path.join(here, "../assets/tray.png")).resize({ width: 16, height: 16, quality: "best" });

const pretty = (accel) => accel.replaceAll("+", " + ");

// ---------- Launching without a terminal (launch.js): shortcuts and start-with-Windows ----------

const writeShortcuts = () => writeLaunchShortcuts({ icon: ICON, appId: APP_ID, description: `Desktop Buddy: ask about anything on your screen (${keyLabel(hotkey("ask"))})` });

// Once per install: put Buddy in Start and on the desktop, and start it at sign-in. Later Settings owns both.
function firstRunSetup() {
  if (process.platform !== "win32" || settings.launchSetupDone) return;
  if (!app.isPackaged) writeShortcuts(); // the installer already made them
  setStartsWithWindows(true);
  changeSettings({ launchSetupDone: true });
}

// ---------- Settings: stored in settings.js, applied here the moment they change ----------

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");

/**
 * Applies a change from the Settings window (or the tray). Shortcuts are tried before they're kept: one another app
 * already owns is refused and reported, and the old one stays. Returns the reason each refused field was refused.
 * @param {any} patch
 * @returns {Record<string, string>}
 */
function changeSettings(patch) {
  const before = settings;
  const { settings: next, rejected } = updateSettings(settings, patch);
  /** @type {Record<string, string>} */
  const problems = {};
  for (const field of rejected) {
    const name = field.startsWith("hotkeys.") ? field.slice(8) : null;
    const clash = name && HOTKEY_NAMES.find((other) => other !== name && next.hotkeys[other] === patch.hotkeys?.[name]);
    problems[field] = clash ? t("Already used for {action}", { action: t(HOTKEY_LABELS[clash]) }) : t("That value isn't allowed");
  }
  for (const name of HOTKEY_NAMES) {
    const accel = next.hotkeys[name];
    if (accel === before.hotkeys[name] || ENV_HOTKEYS[name]) continue;
    if (!hotkeyIsFree(accel)) {
      next.hotkeys[name] = before.hotkeys[name];
      problems[`hotkeys.${name}`] = "Another app already uses this shortcut";
    }
  }
  // A folder Buddy may not read without asking stays off the list, whoever asked for it.
  if (Array.isArray(patch?.readFolders) && next.readFolders) {
    const kept = next.readFolders.filter((dir) => !grantProblem(dir, herePlaces()));
    if (kept.length < next.readFolders.length) problems.readFolders = grantProblem(next.readFolders.find((dir) => !kept.includes(dir)) ?? "", herePlaces()) ?? "That folder isn't allowed";
    next.readFolders = kept;
  }
  settings = next;
  saveSettings(settingsFile(), settings);
  if (!hotkeysSuspended && JSON.stringify(next.hotkeys) !== JSON.stringify(before.hotkeys)) registerHotkeys();
  if (next.accent !== before.accent) paintAccentEverywhere();
  if (next.appearance !== before.appearance) applyAppearance();
  if (next.uiLanguage !== before.uiLanguage) applyLanguage();
  if (next.model !== before.model || next.effort !== before.effort || JSON.stringify(next.providerModels) !== JSON.stringify(before.providerModels)) setBrainDefaults(settings);
  if (next.provider !== before.provider || JSON.stringify(next.providerURLs) !== JSON.stringify(before.providerURLs)) {
    startBrain();
    refreshModels();
  }
  setAgentPolicy(settings);
  if (next.language !== before.language) voice?.prepare();
  if (next.talkBack === "never" && before.talkBack !== "never") hushReply();
  if (next.advanced !== before.advanced) bubble?.webContents.send("advanced", next.advanced);
  buildTrayMenu();
  showIsland({ force: true });
  settingsWindow?.refresh();
  return problems;
}

// The language of Buddy's windows (i18n.js): the one chosen in Settings, or Windows' own. Every open page gets the new
// words at once; the tray is rebuilt by changeSettings.
const stringsNow = () => ({ lang: language(), table: table() });
function applyLanguage() {
  setLanguage(pickLanguage(settings.uiLanguage, app.getPreferredSystemLanguages()));
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send("strings", stringsNow());
}
// Any of Buddy's pages may ask: the words aren't private.
ipcMain.handle("strings", () => stringsNow());

function applyAppearance() {
  nativeTheme.themeSource = /** @type {"system" | "light" | "dark"} */ (process.env.BUDDY_THEME ?? settings.appearance);
}

// The accent colour reaches every Buddy window as one CSS variable (--buddy) that each page draws its accents from.
// Explainer plates keep their own palette: they live in a separate session and are never painted.
const accentCss = new WeakMap(); // webContents -> key of the CSS inserted into it
async function paintAccent(wc) {
  if (wc.isDestroyed() || wc.session !== session.defaultSession) return;
  const old = accentCss.get(wc);
  const key = await wc.insertCSS(`:root { --buddy: ${ACCENTS[settings.accent].hex} !important; }`);
  accentCss.set(wc, key);
  if (old) wc.removeInsertedCSS(old).catch(() => {});
}
const paintAccentEverywhere = () => {
  for (const wc of webContents.getAllWebContents()) paintAccent(wc).catch(() => {});
};
app.on("web-contents-created", (_e, wc) => wc.on("did-finish-load", () => paintAccent(wc).catch(() => {})));

// ---------- Global shortcuts ----------

const HOTKEY_LABELS = { ask: N("Ask"), talk: N("Talk"), mark: N("Mark"), explain: N("Explain"), dictate: N("Dictate") };
const HOTKEY_ACTIONS = { ask: () => toggle(), talk: () => talk(), mark: () => startMarking(), explain: () => explainAt(cursor()), dictate: () => dictate() };
/** @param {import("./settings.js").HotkeyName} name */
const hotkey = (name) => ENV_HOTKEYS[name] ?? settings.hotkeys[name];
const held = new Map(); // shortcut name -> the accelerator Buddy holds for it
let hotkeysSuspended = false;

// Another app may already own a shortcut; Windows gives it to whoever registered first.
function hotkeyIsFree(accel) {
  if ([...held.values()].includes(accel)) return true;
  if (!globalShortcut.register(accel, () => {})) return false;
  globalShortcut.unregister(accel);
  return true;
}

function registerHotkeys() {
  for (const accel of held.values()) globalShortcut.unregister(accel);
  held.clear();
  for (const name of HOTKEY_NAMES) {
    const accel = hotkey(name);
    if (globalShortcut.register(accel, () => pressHotkey(name))) held.set(name, accel);
    else console.error(`Could not register ${accel}`);
  }
}

// While the Settings window records a new shortcut, Buddy lets go of its own, so pressing one of them is recorded
// instead of opening the bubble or the mic.
function suspendHotkeys(on) {
  hotkeysSuspended = on;
  if (on) {
    for (const accel of held.values()) globalShortcut.unregister(accel);
    held.clear();
  } else registerHotkeys();
}

/** Shortcuts Buddy couldn't take because another app owns them. */
const takenHotkeys = () => (hotkeysSuspended ? [] : HOTKEY_NAMES.filter((n) => !held.has(n)));

// ---------- Tray ----------

function createTray() {
  tray = new Tray(trayIcon());
  tray.on("click", () => summon());
  buildTrayMenu();
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setToolTip(`Desktop Buddy — ask: ${pretty(keyLabel(hotkey("ask")))} · talk: ${pretty(keyLabel(hotkey("talk")))}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `${t("Ask Buddy")}  (${keyLabel(hotkey("ask"))})`, click: () => summon() },
      { label: `${t("Talk to Buddy")}  (${keyLabel(hotkey("talk"))})`, click: () => talkByClick() },
      { label: `${t("Mark or explain something")}  (${keyLabel(hotkey("mark"))})`, click: () => startMarking() },
      { label: t("New conversation"), click: () => resetBubble() },
      meetings.state === "on"
        ? { label: t("Stop meeting notes"), click: () => stopMeetingNotes() }
        : { label: t("Take meeting notes"), click: () => startMeetingNotes().then((r) => notice(r.error ?? t("Taking notes. Let everyone know: in some places they have to agree to it."))) },
      ...(lessons?.list().length ? [{ label: t("Play a lesson"), submenu: lessons.list().slice(-15).reverse().map((l) => ({ label: `${l.title}  (${appName(l.app)})`, click: () => playLesson(l.id) })) }] : []),
      ...(settings.advanced ? [{ label: t("New task window"), click: () => newTask() }] : []),
      { type: "separator" },
      ...(updates?.state().status === "ready" ? [{ label: t("Restart to update to {version}", { version: updates.state().next }), click: () => updates.install() }] : []),
      ...(appStatus().code !== "missing" ? [{ label: t("Quick chat in Claude Code"), click: () => openQuickChat() }] : []),
      { label: t("Recent changes…"), click: () => settingsWindow.open("activity") },
      { label: t("Report a problem…"), click: () => settingsWindow.open("report") },
      { label: t("Settings…"), click: () => settingsWindow.open() },
      { label: "Recreate shortcuts", visible: process.platform === "win32" && !app.isPackaged, click: writeShortcuts },
      { type: "separator" },
      { label: `agent-desktop: ${path.basename(resolveBinary())}`, enabled: false },
      { label: t("Quit"), click: () => app.quit() },
    ]),
  );
}

// ---------- The Settings window ----------

const PREVIEW_LINE = "Hi, I'm Buddy. Click the Formulas tab, and I'll show you the next step.";
const explainersDir = () => path.join(app.getPath("userData"), "explainers");
const timingLog = () => path.join(app.getPath("userData"), "timing.log");

// What the Settings page shows. The API key itself never leaves this process: the page only learns whether one is saved.
function settingsState() {
  let explainers = 0;
  let logBytes = 0;
  try {
    explainers = fs.readdirSync(explainersDir()).filter((f) => f.endsWith(".html")).length;
  } catch {}
  try {
    logBytes = [timingLog(), timingLog().replace(/\.log$/, ".old.log")].reduce((n, f) => n + (fs.statSync(f, { throwIfNoEntry: false })?.size ?? 0), 0);
  } catch {}
  return {
    settings,
    accents: ACCENTS,
    models: MODELS.map((x) => ({ ...x, note: t(x.note) })),
    efforts: EFFORTS,
    voices: VOICES,
    speed: SPEED,
    defaultHotkeys: DEFAULTS.hotkeys,
    labels: Object.fromEntries(Object.entries(HOTKEY_LABELS).map(([k, v]) => [k, t(v)])),
    // Set by environment variables, which win over Settings; the page shows these as fixed.
    fixed: {
      hotkeys: HOTKEY_NAMES.filter((n) => ENV_HOTKEYS[n]),
      voice: !!process.env.BUDDY_VOICE,
      model: !!process.env.BUDDY_MODEL,
      effort: !!process.env.BUDDY_EFFORT,
      appearance: !!process.env.BUDDY_THEME,
    },
    taken: takenHotkeys(),
    folders: { list: readFolders(), usual: !settings.readFolders, home: os.homedir() },
    key: (() => {
      const saved = savedKey(currentProvider());
      const usable = !!loadApiKey();
      // A key saved for another address: Settings asks for one for this address instead.
      const elsewhere = !!saved && !usable && boundToAddress(currentProvider()) ? saved.origin : null;
      return { saved: !!saved && !elsewhere, elsewhere, fromEnv: !!envKey(), env: PROVIDERS[currentProvider()].keyEnv };
    })(),
    providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, label: t(p.label), note: t(p.note), key: p.key, local: !!p.local, keyFrom: p.keyFrom, placeholder: p.placeholder, saved: !!envKey(p.id) || fs.existsSync(keyFile(p.id)), address: providerURL(p.id), defaultAddress: PROVIDERS[p.id].baseURL ?? null, ready: providerReady(p.id) })),
    providerModels: modelListState(),
    modelCheck: ((modelCheck) => modelCheck && { model: modelCheck.model, provider: modelCheck.provider, running: modelCheck.running, stopped: !!modelCheck.stopped, done: modelCheck.done, total: modelCheck.total, passed: modelCheck.passed, missed: modelCheck.missed })(providerState.modelCheck()),
    tested: testedOf(providerURL() ?? undefined, chosenModel() ?? ""),
    checkTasks: CASES.length,
    activity: (activity?.list() ?? []).slice(0, 200).map((e) => ({ id: e.id, at: e.at, from: e.from, kind: e.kind, summary: e.summary, undone: e.undone ?? null, canUndo: e.canUndo, file: e.file ?? null })),
    spend: spendState(),
    startsWithWindows: process.platform === "win32" && startsWithWindows(),
    data: { explainers, logBytes, conversations: conversations?.count() ?? 0 },
    uiLanguages: LANGUAGES,
    connections: (connectors?.list() ?? []).map((c) => ({ ...c, label: t(c.label), does: t(c.does), ...(c.setup && { setup: t(c.setup) }) })),
    lessons: (lessons?.list() ?? []).slice().reverse().map((l) => ({ id: l.id, title: l.title, app: appName(l.app), steps: l.steps.length })),
    claude: appStatus(),
    aiApps: APP_IDS.map((id) => ({ id, label: APPS[id].label, after: t(APPS[id].after) })),
    updates: updates?.state() ?? null,
    routineInfo: Object.fromEntries(
      settings.routines.map((r) => [
        r.id,
        { schedule: describeSchedule(r.schedule), next: r.enabled ? nextRun(r.schedule, new Date()).toISOString() : null, status: routineStatus.get(r.id) ?? null },
      ]),
    ),
  };
}

// ---------- Routines: tasks Buddy starts on a schedule (routines.js says when) ----------

const ROUTINE_CHECK_MS = 30_000;
const routineWatched = new Map(); // routine id -> when Buddy started watching it (switched on, or Buddy started)
const routineStatus = new Map(); // routine id -> what happened last, for Settings

const markRoutine = (id, patch) => changeSettings({ routines: settings.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

// Starts a routine as a task tucked into the island. It isn't about whatever window happens to be in front, and it
// acts under the Agents rules like any task: anything they don't allow waits on its approval card.
async function runRoutine(r, why) {
  markRoutine(r.id, { lastRun: new Date().toISOString() }); // first, so a slow start can't run it twice
  const result = await tasks.create({ title: r.name, prompt: r.prompt, target: null, tucked: true });
  routineStatus.set(r.id, result.error ? `Couldn't start: ${result.error}` : why === "now" ? "Started just now" : "Started on schedule");
  trace({ kind: "routine", id: r.id, why, error: result.error });
  return result;
}

function checkRoutines() {
  const now = new Date();
  for (const r of settings.routines) {
    if (!r.enabled) {
      routineWatched.delete(r.id);
      continue;
    }
    if (!routineWatched.has(r.id)) routineWatched.set(r.id, now);
    const since = r.lastRun ? new Date(r.lastRun) : routineWatched.get(r.id);
    const v = routineVerdict(r, since, now);
    if (v === "run") runRoutine(r, "schedule");
    else if (v === "skip") {
      routineStatus.set(r.id, "Skipped a run missed while Buddy wasn't running");
      markRoutine(r.id, { lastRun: now.toISOString() });
    }
  }
}

// ---------- Request a feature, report a problem, Buddy Plus (feedback.js) ----------

onFrom(fromBubble, "plus-interest", () => (trace({ kind: "plus-interest", from: "bubble" }), shell.openExternal(PLUS_INTEREST)));

const settingsWindow = createSettingsWindow({
  here,
  icon: ICON,
  state: settingsState,
  change: changeSettings,
  capture: suspendHotkeys,
  // Quiet during a meeting, as all of Buddy's voice is (sound.js).
  preview: (sid, speed) => voice?.say(PREVIEW_LINE, { sid: Math.min(VOICES - 1, Math.max(0, Math.trunc(sid) || 0)), speed: Math.min(SPEED.max, Math.max(SPEED.min, speed || 1)) }),
  setKey: setApiKey,
  setAddress,
  checkModel,
  undo: async (id, force) => {
    const res = (await activity?.undo(id, { force })) ?? { ok: false, message: "Nothing to undo." };
    trace({ kind: "undo", ok: res.ok, changed: !!res.changed });
    return res;
  },
  removeKey: () => {
    fs.rmSync(keyFile(), { force: true });
    if (!envKey() && !providerReady()) brain = null;
    else startBrain();
  },
  setStartup: (on) => process.platform === "win32" && setStartsWithWindows(on),
  clear: (what) => {
    // Forgets what's kept on the PC; open tasks and the bubble carry on, and are kept again after their next answer.
    if (what === "conversations") return conversations?.clear();
    if (what === "log") {
      fs.rmSync(timingLog(), { force: true });
      return fs.rmSync(timingLog().replace(/\.log$/, ".old.log"), { force: true });
    }
    for (const f of fs.readdirSync(explainersDir()).filter((x) => x.endsWith(".html"))) fs.rmSync(path.join(explainersDir(), f), { force: true });
  },
  openData: () => shell.openPath(app.getPath("userData")),
  addFolder: addReadFolder,
  connection: async (action, id, app) => {
    if (action === "disconnect") return (await connectors?.disconnect(id), null);
    if (action === "retry") return (await connectors?.retry(id)) === "connected" ? null : t("Buddy still couldn't reach it. Check your internet connection and try again.");
    if (action === "setup") {
      const error = (await connectors?.setUp(id, app ?? {})) ?? null;
      return error && t(error);
    }
    return connectService(id);
  },
  lesson: async (action, id, win) => {
    if (action === "delete") {
      const failed = lessons?.remove(id);
      if (failed) return failed;
      buildTrayMenu();
      return {};
    }
    const lesson = lessons?.get(id);
    if (!lesson) return { error: "That lesson is gone." };
    if (action === "export") {
      const picked = await dialog.showSaveDialog(win, { title: "Share a lesson", defaultPath: `${lesson.title.replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 60)}.buddy-lesson.json`, filters: [{ name: "Buddy lesson", extensions: ["json"] }] });
      if (picked.canceled || !picked.filePath) return {};
      fs.writeFileSync(picked.filePath, lessons.exportText(id) ?? "");
      trace({ kind: "lesson-exported" });
      return { saved: true };
    }
    // Play: Settings steps aside so the app the lesson is for can be seen; how it went shows on the island.
    win.minimize();
    await playLesson(id);
    return {};
  },
  importLesson: async (win) => {
    const picked = await dialog.showOpenDialog(win, { title: "Import a lesson", properties: ["openFile"], filters: [{ name: "Buddy lesson", extensions: ["json"] }] });
    const file = picked.canceled ? null : picked.filePaths[0];
    if (!file || !lessons) return {};
    if (fs.statSync(file).size > 200_000) return { error: "That file is too big to be a Buddy lesson." };
    const added = lessons.importText(fs.readFileSync(file, "utf8"));
    if ("error" in added) return { error: added.error };
    trace({ kind: "lesson-imported", steps: added.lesson.steps.length });
    buildTrayMenu();
    return { title: added.lesson.title };
  },
  runRoutine: (id) => {
    const r = settings.routines.find((x) => x.id === id);
    return r ? runRoutine(r, "now").then((res) => res.error ?? null) : Promise.resolve("That routine no longer exists.");
  },
  // Apps with a window open now, as suggestions for the Agents lists.
  apps: async () => [...new Set((await listWindows()).map((w) => w.app_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
  requestFeature,
  report: () => problemReport({ timingLog: timingLog(), settings }),
  sendReport: (how, body) => (trace({ kind: "problem-report", how }), sendProblemReport(how, body)),
  plusInterest: () => (trace({ kind: "plus-interest", from: "settings" }), shell.openExternal(PLUS_INTEREST)),
  checkUpdates: () => updates?.check(),
  installUpdate: () => updates?.install(),
  openReleases: () => shell.openExternal(RELEASES),
  openNotices: () => shell.openPath(app.isPackaged ? path.join(process.resourcesPath, "THIRD_PARTY_NOTICES.md") : path.join(here, "../THIRD_PARTY_NOTICES.md")),
  setClaude,
});

// ---------- App updates (updates.js) ----------

let announcedUpdate = null;
function startUpdates() {
  updates = createUpdates({
    enabled: () => settings.autoUpdate,
    onChange: (state) => {
      buildTrayMenu();
      settingsWindow.refresh();
      // Say so once, on the island; the tray and Settings keep offering the restart.
      if (state.status === "ready" && announcedUpdate !== state.next) {
        announcedUpdate = state.next;
        notice(t("Buddy {version} is ready: restart from the tray to update", { version: state.next }));
      }
    },
    trace,
  });
  updates.start();
}
onFrom(fromBubble, "open-settings", (_e, page) => settingsWindow.open(page === "claude" || page === "lessons" ? page : undefined));
// "Fix this step" under a lesson that stopped, or "Not now".
onFrom(fromBubble, "repair-lesson", () => repairLesson());
onFrom(fromBubble, "repair-dismiss", () => { lessonStuck = null; });
// A lesson from the shelf, played in the window they called Buddy from. Only a lesson for that window's app: the
// shelf offers no others, and a lesson only points, so a wrong id has nothing to play.
onFrom(fromBubble, "play-lesson", (_e, id) => {
  const lesson = lessons?.get(String(id));
  if (!lesson || !about.window || appKey(lesson.app) !== appKey(about.window.app_name)) return;
  playLesson(lesson.id, { window: about.window });
});

// Whether this run is a dev or end-to-end check: a BUDDY_*_TEST variable is set (dev-hooks.js runs it).
const devHook = Object.entries(process.env).some(([name, value]) => value && /^BUDDY_[A-Z_]+_TEST$/.test(name));

/** What dev-hooks.js may use. Variables main.js reassigns are getters, so a hook always sees the current one. @returns {import("./dev-hooks.js").DevKit} */
const devKit = () => ({
  here, trace, point, guidePoint, confirm, summon, toggle, ownPids, startMarking, cancelMarking, stopMarkMode, enter, currentMode, grabDisplay,
  toLocalRect, annotationLayer, showAnnotations, releaseLater, openExplainer, changeSettings, settingsState, settingsFile, settingsWindow, runRoutine,
  typeText, saveApiKey, loadApiKey, providerURL, prepareScreenImage, timingLog, documentsDir, startBrain, spendState,
  bubble, island, tasks, voice, updates, activity, pressHotkey, sendVoiceOffer, startupVoiceFetch,
  useKeyHook: (/** @type {import("./hold-key.js").KeyHook} */ hook) => { keyHook = hook; },
  get settings() { return settings; },
  get lessons() { return lessons; },
  get connectors() { return connectors; },
  offerConnection,
  startMeetingNotes,
  stopMeetingNotes,
  meetingUI,
  meetingPage: () => meetingCapture?.page() ?? null,
  get meetingState() { return meetings.state; },
  hushReply,
  playLesson,
  get brain() { return brain; },
  set brain(b) { brain = b; },
  get about() { return about; },
  set about(a) { about = a; },
  get markDisplay() { return marker.display(); },
  markDisplaysChanged: (/** @type {Electron.Display[]} */ displays) => marker.displaysChanged(displays),
  get markWin() { return marker.window(); },
  get markLive() { return marker.liveOverlay(); },
  get markBar() { return marker.liveBar(); },
  get pendingMarks() { return marker.pending(); },
  get displayCaptures() { return displayCaptures; },
});

app.whenReady().then(() => {
  const loaded = loadSettings(settingsFile());
  settings = loaded.settings;
  if (loaded.recovered) trace({ kind: "settings-recovered", note: "settings.json couldn't be read; kept as settings.json.bad" });
  applyAppearance();
  applyLanguage();
  setBrainDefaults(settings);
  loadModelCaps();
  startActivity();
  startLedger();
  conversations = createConversations({ file: path.join(app.getPath("userData"), "conversations.json") });
  lessons = createLessons({ file: path.join(app.getPath("userData"), "lessons.json") });
  connectors = createConnectors({ dir: path.join(app.getPath("userData"), "connectors"), safeStorage, open: openSignIn, trace, onChange: () => settingsWindow?.refresh() });
  connectors.start().catch(() => {});
  // Whether Calculator is installed is asked now (a fraction of a second, once), so the welcome doesn't wait on it.
  calculatorInstalled();
  // A meeting Buddy closed during: its transcript, saved as it grew, becomes a document.
  recoverTranscript(meetingFile(), writeNotes).then((file) => {
    if (!file) return;
    recordChange({ kind: "document", summary: t("Saved the transcript of a meeting Buddy closed during"), file, from: "Buddy" });
    notice(t("Saved the transcript of a meeting Buddy closed during"));
  }).catch((err) => trace({ kind: "meeting-recover-failed", why: String(err?.message ?? err).slice(0, 200) }));
  refreshModels().catch(() => {});
  setAgentPolicy(settings);
  app.setAppUserModelId(APP_ID);
  const devRun = devHook || process.env.BUDDY_THEME;
  // First-run setup (shortcuts, start with Windows) changes the user's PC, so only the real Buddy does it: never a dev
  // check, and never a test copy with a data folder of its own (--user-data-dir), which would otherwise leave a second
  // copy starting at sign-in.
  if (!devRun && !app.commandLine.hasSwitch("user-data-dir")) firstRunSetup();
  lockExplainerSession();
  clearOldSessions();
  startBrain();
  // The bubble's conversation, if Buddy restarted before it would have been forgotten anyway.
  const earlier = conversations.bubble(IDLE_RESET_MS);
  if (earlier && brain) {
    brain.resume(earlier.transcript);
    turn = { ...turn, at: earlier.savedAt };
  }
  createOverlays();
  createIsland();
  createBubble();
  createTray();
  appBridge.start();
  // Only the real Buddy points Claude's apps at itself, never a test copy with its own data folder.
  if (!app.commandLine.hasSwitch("user-data-dir")) repairClaude().catch((err) => trace({ kind: "claude-setup", why: "repair", error: String(err) }));
  startTasks();
  tasks.restore();
  startVoice();
  startUpdates();
  setTimeout(checkRoutines, 10_000);
  setInterval(checkRoutines, ROUTINE_CHECK_MS);
  trackCursor();
  watchCpu();
  setInterval(keepIsland, 1500);
  const displaysChanged = () => {
    // Marking on a display that just went or changed ends first: its strokes can't be placed any more.
    marker.displaysChanged();
    createOverlays();
    keepIsland();
  };
  screen.on("display-added", displaysChanged);
  screen.on("display-removed", displaysChanged);
  screen.on("display-metrics-changed", displaysChanged);
  registerHotkeys();
  // A dev or end-to-end check (a BUDDY_*_TEST variable) runs from dev-hooks.js, loaded only then.
  if (devHook) import("./dev-hooks.js").then(({ runDevHook }) => runDevHook(devKit()));
  else if (!brain) summon();
});

app.on("window-all-closed", (e) => e.preventDefault());
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  appBridge.close();
});
