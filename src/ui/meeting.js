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

/** @param {{ testMic?: Uint8Array }} o  testMic: a recording (WAV bytes) played as the microphone, for the end-to-end check */
async function start({ testMic } = {}) {
  if (meeting) return;
  const ctx = new AudioContext();
  const m = { t0: performance.now(), sources: [], ctx, streams: [] };
  meeting = m;
  await ctx.audioWorklet.addModule("voice-capture.js");
  const state = { started: true, others: false, you: false, problems: [] };
  try {
    const sound = await systemSound();
    m.streams.push(sound);
    m.sources.push(listenTo(ctx, ctx.createMediaStreamSource(sound), "others", m.t0));
    state.others = true;
  } catch (err) {
    state.problems.push(`others: ${err?.name ?? err}`);
  }
  try {
    if (testMic) {
      const buffer = await ctx.decodeAudioData(testMic.slice().buffer);
      const play = ctx.createBufferSource();
      play.buffer = buffer;
      m.sources.push(listenTo(ctx, play, "you", m.t0));
      play.start();
    } else {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      m.streams.push(mic);
      m.sources.push(listenTo(ctx, ctx.createMediaStreamSource(mic), "you", m.t0));
    }
    state.you = true;
  } catch (err) {
    state.problems.push(`you: ${err?.name === "NotAllowedError" ? "mic-blocked" : err?.name ?? err}`);
  }
  if (meeting !== m) return close(m);
  window.buddy.meetingState(state);
}

function close(m) {
  m.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
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
});
