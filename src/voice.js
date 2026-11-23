// Voice: Buddy listens when asked (hotkey or the bubble's mic) and talks back. The hidden voice window owns the
// microphone and the speakers; the speech child process (speech.js) runs Moonshine and Supertonic. Everything stays
// on this PC.
import { BrowserWindow, ipcMain } from "electron";
import { fork } from "node:child_process";
import path from "node:path";
import { ASR, ASR_MULTI, TTS, isInstalled, removeLegacy } from "./models.js";
import { createSound } from "./sound.js";
import { pieces } from "./speakable.js";

// The models hold ~520 MB while loaded. They load the moment the user starts talking (Moonshine is ready before
// they finish their sentence, Supertonic before Claude answers) and unload after this long unused.
const UNLOAD_AFTER_MS = 10 * 60_000;
// How long each speech request may take. Warming can include the first download (~275 MB) on a slow connection.
const DEADLINE_MS = { init: 15_000, warm: 30 * 60_000, transcribe: 60_000, speak: 60_000 };
// How long past a clip's own length to wait for the voice page to say it finished playing.
const PLAY_GRACE_MS = 5_000;

/**
 * `getVoice` says which voice and pace to speak in, and `getLanguage` which language to listen for ("en" or "auto");
 * both come from Settings and are asked every time.
 * @param {{ here: string, cacheDir: string, getVoice: () => { sid: number, speed: number, lang?: string },
 *           getLanguage: () => string,
 *           onState: (state: string, info?: object) => void, onLevel: (level: number) => void, onSound?: () => void, trace?: (entry: object) => void }} opts
 * `onSound` is told each time a clip starts playing (for the ask-to-pointer timing's first sound).
 */
export function createVoice({ here, cacheDir, getVoice, getLanguage, onState, onLevel, onSound = () => {}, trace = () => {} }) {
  let speech = null;
  let unloadTimer = null;
  let seq = 0;
  const pending = new Map();
  let win = null;
  // Who has the microphone and the speaker (sound.js): every move below asks it first.
  const sound = createSound({ trace });
  let heard = null; // resolves the open take's listen() or dictate()
  let played = new Map();
  let gen = 0; // bumps on hush, so a reply being spoken stops between pieces
  let line = null; // what Buddy is saying now, which more of the same reply can join (say's `join`)

  function startSpeech() {
    const proc = fork(path.join(here, "speech.js"), [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      serialization: "advanced", // audio travels as Float32Array
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true,
    });
    speech = proc;
    proc.on("message", (/** @type {any} */ msg) => {
      if (msg.type === "progress") return onState("downloading", msg);
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      msg.ok ? job.resolve(msg) : job.reject(new Error(msg.error));
    });
    // An unloaded engine's late exit must not take down the one started after it.
    proc.on("exit", () => {
      if (speech === proc) fail("The speech engine stopped");
    });
    request("init", { cacheDir });
  }

  // Ends every waiting request with `reason` and drops the engine; the next request starts a fresh one.
  function fail(reason) {
    const proc = speech;
    speech = null;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(reason));
    }
    pending.clear();
    proc?.kill();
  }

  function idleLater() {
    clearTimeout(unloadTimer);
    unloadTimer = setTimeout(() => {
      if (sound.ear !== "off" || sound.mouth === "speaking" || pending.size) return idleLater();
      speech?.kill();
      speech = null;
    }, UNLOAD_AFTER_MS);
  }

  // Every request has a deadline. An engine that stops answering (a native error that never reaches its handler, a
  // hung model) would otherwise leave Buddy "speaking" or "listening" forever; past the deadline the engine is
  // restarted and the request fails like any other error.
  function request(type, data = {}) {
    if (!speech) startSpeech();
    idleLater();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        trace({ kind: "voice-timeout", job: type });
        fail(`The speech engine didn't answer (${type})`);
      }, DEADLINE_MS[type] ?? 60_000);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      pending.set(id, { resolve: settle(resolve), reject: settle(reject), timer });
      speech.send({ id, type, ...data });
    });
  }

  function createWindow() {
    win = new BrowserWindow({ show: false, width: 200, height: 100, skipTaskbar: true, webPreferences: { preload: path.join(here, "preload.cjs"), backgroundThrottling: false } });
    win.loadFile(path.join(here, "ui/voice.html"));
    win.on("closed", () => (win = null));
    // A voice page that crashes or can't load ends what it was doing, so Buddy isn't left listening (or waiting on a
    // clip) forever; the next request makes a new one.
    const gone = (/** @type {string} */ why) => {
      trace({ kind: "voice-page-gone", why });
      const dead = win;
      win = null;
      if (dead && !dead.isDestroyed()) dead.destroy();
      endTake(sound.take, { error: "voice-page-gone" });
      for (const resolve of played.values()) resolve();
      played.clear();
    };
    win.webContents.on("render-process-gone", (_e, d) => gone(d.reason));
    win.webContents.on("did-fail-load", (_e, code) => gone(`load ${code}`));
  }
  /** Ends take `n` with `result`, if it's still the open one. */
  function endTake(/** @type {number} */ n, /** @type {any} */ result) {
    if (!sound.close(n)) return;
    const done = heard;
    heard = null;
    done?.(result);
  }
  const send = (payload) => {
    if (!win || win.isDestroyed()) createWindow();
    const go = () => win.webContents.send("voice", payload);
    win.webContents.isLoading() ? win.webContents.once("did-finish-load", go) : go();
  };

  const fromVoice = (e) => win && e.sender === win.webContents;
  ipcMain.on("voice-state", (e, state) => fromVoice(e) && onState(state));
  ipcMain.on("voice-level", (e, level) => fromVoice(e) && onLevel(Number(level) || 0));
  // What the page heard counts only for the take it was for: a cancelled take's late answer can't end the next one.
  ipcMain.on("voice-heard", (e, result) => {
    if (fromVoice(e)) endTake(Number(result?.take), result);
  });
  let onSegment = null; // where the pieces of a continuous dictation go
  ipcMain.on("voice-segment", (e, result) => {
    if (fromVoice(e) && result?.pcm && sound.current(Number(result.take))) onSegment?.(result.pcm);
  });
  ipcMain.on("voice-played", (e, id) => {
    if (!fromVoice(e)) return;
    played.get(id)?.();
    played.delete(id);
  });

  // Transcribes 16 kHz audio in the listening language from Settings. Resolves { text, lang, heardMs } or { error };
  // `lang` is the language heard (a two-letter code), which is always "en" unless detection is on, and `heardMs` how
  // long the transcription took.
  async function hear(pcm) {
    const t0 = Date.now();
    try {
      const { text, lang } = await request("transcribe", { pcm, language: getLanguage() });
      const heardMs = Date.now() - t0;
      trace({ kind: "voice-heard", ms: heardMs, seconds: +(pcm.length / 16000).toFixed(1), lang });
      // Recognizers can fill silence with tags like "[BLANK_AUDIO]" or "(wind blowing)"; drop them.
      const clean = text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim();
      return clean.replace(/[.\s]/g, "") ? { text: clean, lang: lang || "en", heardMs } : { error: "silence" };
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Records until the user stops talking, then transcribes. Resolves { text, lang, heardMs, endedAt } or { error };
   * `endedAt` is when their speech ended (the clock a spoken question's timing starts from).
   */
  async function listen() {
    // Refused before anything else, so a listen that can't happen doesn't cut off what Buddy is saying.
    if (!sound.mayOpen()) return { error: "busy" };
    hush();
    warm();
    const take = sound.open("listening");
    const result = await new Promise((resolve) => {
      heard = resolve;
      send({ cmd: "listen", take });
    });
    if (!result?.pcm) return { error: result?.error ?? "cancelled" };
    const endedAt = Date.now();
    onState("transcribing");
    return { ...(await hear(result.pcm)), endedAt };
  }

  /**
   * Dictation: hands each piece of what the user says to `onText`, in order, as soon as it is transcribed. With
   * `continuous` it keeps listening through pauses until finishListening(); otherwise it stops at the first pause.
   * Resolves { pieces } (how many were typed) or { error }.
   * @param {{ continuous: boolean, onText: (text: string) => Promise<void> }} how
   */
  async function dictate({ continuous, onText }) {
    if (!sound.mayOpen()) return { error: "busy" };
    hush();
    warm();
    let chain = Promise.resolve();
    let count = 0;
    let lastError = null;
    const handle = (pcm) => {
      chain = chain.then(async () => {
        const r = await hear(pcm);
        if (r.text) {
          count++;
          await onText(r.text);
        } else if (r.error !== "silence") lastError = r.error;
      });
    };
    onSegment = handle;
    const take = sound.open("dictating");
    const result = await new Promise((resolve) => {
      heard = resolve;
      send({ cmd: "listen", continuous, take });
    });
    onSegment = null;
    if (result?.pcm) handle(result.pcm);
    await chain;
    if (count) return { pieces: count };
    return { error: lastError ?? (result?.error === "cancelled" ? "cancelled" : result?.error && !result?.done ? result.error : "silence") };
  }

  /** Ends listening now and uses what was said so far. */
  const finishListening = () => sound.take && send({ cmd: "finish", take: sound.take });
  /** The Talk key is being held: keep listening through pauses until finishListening(). */
  const holdListening = () => sound.take && send({ cmd: "hold", take: sound.take });
  const cancelListening = () => {
    const take = sound.take;
    if (!take) return;
    send({ cmd: "cancel", take });
    endTake(take, { error: "cancelled" });
  };

  const warm = () => request("warm", { language: getLanguage() }).catch((err) => trace({ kind: "voice-warm-failed", error: err.message }));

  /**
   * Speaks text, a piece at a time, cutting off whatever Buddy was saying. With `join`, text that comes while Buddy is
   * still speaking follows on instead: its first piece is made while the one before plays, so a reply that streams in
   * a sentence at a time has no silence between sentences. Resolves when done or hushed; when done, with the longest
   * silence between two pieces (`gapMs`), which is how long the next one took to be ready after the last one ended.
   */
  async function say(text, how = getVoice(), { join = false } = {}) {
    // Never into an open microphone, nor during a meeting (sound.js): what Buddy said would be heard back, typed into
    // the user's app, or written into the meeting's transcript.
    if (!sound.maySpeak()) return;
    const following = join && line?.mine === gen ? line : null;
    const parts = pieces(text, { first: !following });
    if (!parts.length) return;
    if (following) {
      following.parts.push(...parts);
      following.ahead();
      return following.done;
    }
    hush();
    const mine = ++gen;
    sound.speak();
    onState("speaking");
    const synth = (s) => request("speak", { text: s, ...how }).catch(() => null);
    /** @type {{ mine: number, parts: string[], clips: Promise<any>[], at: number, ahead: () => void, done?: Promise<{ gapMs: number } | undefined> }} */
    const l = { mine, parts, clips: [], at: -1, ahead: () => {} };
    // Only one piece is made ahead, and only once the one before it is ready, so the two never share the CPU.
    l.ahead = () => {
      const next = l.at + 1;
      if (l.at >= 0 && next < l.parts.length) l.clips[next] ??= synth(l.parts[next]);
    };
    line = l;
    l.done = run();
    return l.done;

    async function run() {
      let ended = 0;
      let gapMs = 0;
      try {
        for (let i = 0; i < l.parts.length; i++) {
          const clip = await (l.clips[i] ??= synth(l.parts[i]));
          if (mine !== gen) return;
          if (ended) gapMs = Math.max(gapMs, Date.now() - ended);
          l.at = i;
          l.ahead();
          if (!clip) continue;
          const id = ++seq;
          // If the voice page never reports the clip finished (it reloaded or crashed), move on once the clip's own
          // length and a grace period have passed rather than waiting forever.
          await new Promise((resolve) => {
            const timer = setTimeout(() => {
              played.delete(id);
              trace({ kind: "voice-play-timeout" });
              resolve(undefined);
            }, (clip.audio.length / clip.rate) * 1000 + PLAY_GRACE_MS);
            played.set(id, () => {
              clearTimeout(timer);
              resolve(undefined);
            });
            send({ cmd: "play", id, audio: clip.audio, rate: clip.rate });
            onSound();
          });
          if (mine !== gen) return;
          ended = Date.now();
        }
        return { gapMs };
      } finally {
        if (line === l) line = null;
        if (mine === gen) {
          sound.quiet();
          onState("quiet");
        }
      }
    }
  }

  function hush() {
    gen++;
    for (const resolve of played.values()) resolve();
    played.clear();
    if (win && !win.isDestroyed()) send({ cmd: "hush" });
    if (sound.mouth === "speaking") {
      sound.quiet();
      onState("quiet");
    }
  }

  return {
    listen,
    dictate,
    finishListening,
    holdListening,
    cancelListening,
    say,
    hush,
    warm,
    // On a first run, fetch the models in the background so the first question isn't a long wait. Caches of the
    // speech models earlier versions used are removed once the current ones are in place.
    /** Whether the models for listening (in the language from Settings) and speaking are on this PC. */
    installed: () => [getLanguage() === "auto" ? ASR_MULTI : ASR, TTS].every((m) => isInstalled(cacheDir, m)),
    prepare: async () => {
      const needed = [getLanguage() === "auto" ? ASR_MULTI : ASR, TTS];
      if (!needed.every((m) => isInstalled(cacheDir, m))) await warm();
      if (needed.every((m) => isInstalled(cacheDir, m))) {
        const removed = removeLegacy(cacheDir);
        if (removed.length) trace({ kind: "voice-legacy-removed", removed });
      }
    },
    synthesize: (text, how = {}) => request("speak", { text, ...getVoice(), ...how }),
    // Dev checks play replies silently.
    mute: () => {
      if (!win || win.isDestroyed()) createWindow();
      win.webContents.setAudioMuted(true);
    },
    transcribe: (pcm, language = getLanguage()) => request("transcribe", { pcm, language }),
    /** Meeting notes started or ended: Buddy goes quiet, and stays so until they end (sound.js). @param {boolean} on */
    setMeeting(on) {
      sound.setMeeting(on);
      if (on) hush();
    },
    get listening() {
      return sound.ear !== "off";
    },
    get speaking() {
      return sound.mouth === "speaking";
    },
  };
}
