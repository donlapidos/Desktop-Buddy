// The meeting page (meeting.html), hidden. A classic script, not a module. Type-checked with the rest of Buddy
// (tsconfig.json).
// Buddy's ears in a meeting (meeting.js in the main process): the microphone ("you") and the PC's sound output
// ("others": the meeting app's sound, whichever app it is). Each is cut into pieces at pauses and handed over as
// 16 kHz mono with its time from the start, to be transcribed. Nothing is kept here; both close on "stop".
const RATE = 16000; // the speech recognizer's rate
const FRAME_MS = 50;
const END_SILENCE_MS = 700; // a pause this long ends a piece
const PIECE_MAX_MS = 20_000; // a run of speech with no pause is cut here, so no piece is too long to transcribe well
const PRE_ROLL_MS = 300;

/** @type {{ t0: number, sources: any[], ctx: AudioContext | null } | null} */
let meeting = null;

// Samples arrive at the device rate; the recognizer wants 16 kHz mono. Average each output sample's span.
function downsample(chunks, from) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { input.set(c, o); o += c.length; }
  if (from === RATE) return input;
  const ratio = from / RATE;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/**
 * Listens to one source and hands over its pieces. Energy-based: learn the source's background level, call anything
 * well above it speech, and end a piece after a short pause.
 * @param {AudioContext} ctx @param {AudioNode} node @param {"you" | "others"} who @param {number} t0
 */
function listenTo(ctx, node, who, t0) {
  // floor: the background level, starting from a quiet room's.
  const s = { who, chunks: [], frame: [], speech: false, start: 0, lastVoice: 0, floor: 0.003, loud: 0, worklet: null };
  const frameSize = Math.round((ctx.sampleRate * FRAME_MS) / 1000);
  const keep = Math.ceil((ctx.sampleRate * PRE_ROLL_MS) / 1000 / 1536) + 1;
  const worklet = new AudioWorkletNode(ctx, "capture");
  s.worklet = worklet;
  node.connect(worklet);
  worklet.port.onmessage = ({ data }) => {
    s.chunks.push(data);
    for (const v of data) {
      s.frame.push(v * v);
      if (s.frame.length >= frameSize) onFrame(s, Math.sqrt(s.frame.reduce((a, b) => a + b, 0) / s.frame.length));
    }
    if (!s.speech && s.chunks.length > keep) s.chunks.splice(0, s.chunks.length - keep);
  };
  function onFrame(st, rms) {
    st.frame = [];
    const now = performance.now() - t0;
    // The background level follows quiet moments down at once and creeps up only slowly, so a meeting that's already
    // talking when notes start (its first frames are speech) isn't taken for the background.
    st.floor = rms < st.floor ? rms : st.floor * 0.998 + rms * 0.002;
    if (rms > Math.max(0.01, st.floor * 3)) {
      if (++st.loud >= 2 && !st.speech) {
        st.speech = true;
        st.start = Math.max(0, now - PRE_ROLL_MS);
      }
      st.lastVoice = now;
    } else st.loud = 0;
    if (st.speech && (now - st.lastVoice > END_SILENCE_MS || now - st.start > PIECE_MAX_MS)) hand(st, now);
  }
  function hand(st, now) {
    window.buddy.meetingPiece({ who: st.who, start: Math.round(st.start), end: Math.round(now), pcm: downsample(st.chunks, ctx.sampleRate) });
    st.chunks = [];
    st.speech = false;
    st.loud = 0;
  }
  // What's still being said when the meeting stops goes too.
  s.flush = () => s.speech && hand(s, performance.now() - t0);
  return s;
}

/** The PC's sound output. getDisplayMedia hands over a screen too, which isn't wanted: it's stopped at once. */
async function systemSound() {
  const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  shared.getVideoTracks().forEach((t) => t.stop());
  if (!shared.getAudioTracks().length) throw new Error("no-system-sound");
  return new MediaStream(shared.getAudioTracks());
}

const microphone = () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

// A side's sound can end mid-meeting: a headset unplugged, a Bluetooth headset switching modes, the output device
// changed. Its last words are kept, and the side is opened again; Buddy is told, so a side that stays gone is said.
const REOPEN_WAITS_MS = [500, 1500, 4000];

/** Starts hearing one side from a live stream, watching for the stream to end. */
function hear(m, stream, who) {
  const s = listenTo(m.ctx, m.ctx.createMediaStreamSource(stream), who, m.t0);
  s.stream = stream;
  m.sources.push(s);
  for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => lost(m, who));
  return s;
}

/** Lets go of a side: what it was saying is handed over, then its stream is stopped. */
function drop(m, who) {
  for (const s of m.sources.filter((x) => x.who === who)) {
    s.flush();
    s.worklet.port.onmessage = null;
    s.stream?.getTracks().forEach((t) => t.stop());
  }
  m.sources = m.sources.filter((x) => x.who !== who);
}

/** A side's sound ended: try to open it again, a few times, and say how it went. */
async function lost(m, who) {
  if (meeting !== m || m.reopening.has(who)) return;
  m.reopening.add(who);
  drop(m, who);
  window.buddy.meetingEvent({ who, lost: true });
  for (const ms of REOPEN_WAITS_MS) {
    await new Promise((r) => setTimeout(r, ms));
    if (meeting !== m) return;
    try {
      const stream = who === "you" ? await microphone() : await systemSound();
      if (meeting !== m) return stream.getTracks().forEach((t) => t.stop());
      hear(m, stream, who);
      m.reopening.delete(who);
      return window.buddy.meetingEvent({ who, back: true });
    } catch {}
  }
  m.reopening.delete(who);
  if (meeting === m) window.buddy.meetingEvent({ who, gone: true });
}

/** A headset plugged in becomes Windows' default microphone: follow it, as the meeting app does. */
async function followDefaultMic(m) {
  const mine = m.sources.find((s) => s.who === "you" && s.stream);
  if (meeting !== m || !mine || m.reopening.has("you")) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const preferred = devices.find((d) => d.kind === "audioinput" && d.deviceId === "default");
  const using = mine.stream.getAudioTracks()[0]?.getSettings().groupId;
  if (!preferred || !using || preferred.groupId === using) return;
  m.reopening.add("you");
  try {
    const stream = await microphone();
    if (meeting !== m) return stream.getTracks().forEach((t) => t.stop());
    drop(m, "you");
    hear(m, stream, "you");
    window.buddy.meetingEvent({ who: "you", switched: true });
  } catch {
    // The old microphone carries on; if it's gone, its ending says so.
  } finally {
    m.reopening.delete("you");
  }
}

/**
 * @param {{ testMic?: Uint8Array, testQuiet?: boolean, since?: number }} o  testMic: a recording (WAV bytes) played as
 *   the microphone, for the end-to-end check; testQuiet: a silent stand-in microphone (the check's page, opened
 *   again); since: how far into the meeting this page starts (ms), when it replaces one that crashed
 */
async function start({ testMic, testQuiet, since = 0 } = {}) {
  if (meeting) return;
  const ctx = new AudioContext();
  const m = { t0: performance.now() - Math.max(0, Number(since) || 0), sources: [], ctx, reopening: new Set(), onDevices: () => followDefaultMic(m).catch(() => {}) };
  meeting = m;
  await ctx.audioWorklet.addModule("voice-capture.js");
  const state = { started: true, others: false, you: false, problems: [] };
  try {
    hear(m, await systemSound(), "others");
    state.others = true;
  } catch (err) {
    state.problems.push(`others: ${err?.name ?? err}`);
  }
  try {
    if (testQuiet) {
      // Nothing to hear on this side.
    } else if (testMic) {
      const buffer = await ctx.decodeAudioData(testMic.slice().buffer);
      const play = ctx.createBufferSource();
      play.buffer = buffer;
      m.sources.push(listenTo(ctx, play, "you", m.t0));
      play.start();
    } else {
      hear(m, await microphone(), "you");
      navigator.mediaDevices.addEventListener("devicechange", m.onDevices);
    }
    state.you = true;
  } catch (err) {
    state.problems.push(`you: ${err?.name === "NotAllowedError" ? "mic-blocked" : err?.name ?? err}`);
  }
  if (meeting !== m) return close(m);
  window.buddy.meetingState(state);
}

function close(m) {
  navigator.mediaDevices.removeEventListener("devicechange", m.onDevices);
  m.sources.forEach((s) => s.stream?.getTracks().forEach((t) => t.stop()));
  m.ctx?.close();
}

function stop() {
  const m = meeting;
  meeting = null;
  if (!m) return window.buddy.meetingState({ stopped: true });
  m.sources.forEach((s) => s.flush());
  close(m);
  window.buddy.meetingState({ stopped: true });
}

window.buddy.onMeeting((/** @type {any} */ cmd) => {
  if (cmd?.cmd === "start") start(cmd).catch((err) => window.buddy.meetingState({ started: false, problems: [String(err?.message ?? err)] }));
  else if (cmd?.cmd === "stop") stop();
  // End-to-end check: a side's sound ends, as an unplugged device's does.
  else if (cmd?.cmd === "test-end" && meeting) meeting.sources.find((s) => s.who === cmd.who)?.stream?.getAudioTracks().forEach((t) => (t.stop(), t.dispatchEvent(new Event("ended"))));
});
