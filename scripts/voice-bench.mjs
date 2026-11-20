// Compares on-device voices for Buddy: how soon each starts speaking, how fast it speaks, how much memory it holds,
// and a sample of each to judge by ear. Every voice runs through sherpa-onnx, the engine Buddy already uses
// (speech.js), each in a process of its own so the memory figures don't mix.
//
//   node scripts/voice-bench.mjs <folder of unpacked sherpa-onnx voice models> [--out <folder>]
//
// The models come from https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models, unpacked as they are. The
// installed Supertonic 3 (userData/models) is added when it is there. Writes a WAV per voice and sentence, results.json
// and listen.html (open it to play them side by side).
import { fork } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// What Buddy says: steps, Excel words, numbers, shortcuts, and one line in Spanish for voices that speak it.
export const SENTENCES = [
  { id: "step", text: "Click the Formulas tab, then choose Insert Function." },
  { id: "why", text: "Your VLOOKUP shows N/A because the value in A2 has a space at the end." },
  { id: "numbers", text: "Sales rose from $1.2 million in Q1 to $1.8 million in Q4, up 48 percent." },
  { id: "keys", text: "Press Ctrl+Shift+L to turn on filters for the whole table." },
  { id: "long", text: "I've built the pivot table on a new sheet. Regions are down the side, quarters across the top, and the totals at the bottom match your original data." },
  { id: "es", text: "Haz clic en la pestaña Insertar y luego elige Tabla dinámica.", lang: "es" },
];
const THREADS = 4;

/** The voices found in `dir`, each as the sherpa-onnx config that loads it. */
export function candidates(dir, installed) {
  const found = [];
  const has = (d, f) => fs.existsSync(path.join(d, f));
  const voice = (name, d, model, extra = {}) => found.push({ name, dir: d, model, ...extra });
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const d = path.join(dir, name);
    if (!fs.statSync(d).isDirectory()) continue;
    const f = (x) => path.join(d, x);
    const onnx = fs.readdirSync(d).find((x) => x.endsWith(".onnx")) ?? "";
    if (name.startsWith("kokoro")) {
      const lexicon = ["lexicon-us-en.txt", "lexicon-zh.txt"].filter((x) => has(d, x)).map(f).join(",");
      // v1.0's best-rated American and British voices, and its Spanish ones (speaker IDs from the model's metadata).
      const voices = name.includes("v1_0") ? [{ sid: 3, label: "af_heart" }, { sid: 2, label: "af_bella" }, { sid: 16, label: "am_michael" }, { sid: 26, label: "bm_george" }, { sid: 28, label: "ef_dora", lang: "es" }, { sid: 29, label: "em_alex", lang: "es" }] : [{ sid: 0, label: "af_maple" }, { sid: 1, label: "af_sol" }];
      voice(name, d, { kokoro: { model: f(onnx), voices: f("voices.bin"), tokens: f("tokens.txt"), dataDir: f("espeak-ng-data"), ...(lexicon && { lexicon }) } }, { voices });
    } else if (name.startsWith("kitten")) {
      voice(name, d, { kitten: { model: f(onnx), voices: f("voices.bin"), tokens: f("tokens.txt"), dataDir: f("espeak-ng-data") } }, { voices: [{ sid: 1, label: "voice-2-f" }, { sid: 0, label: "voice-2-m" }] });
    } else if (name.includes("pocket")) {
      const p = (stem) => f(fs.readdirSync(d).find((x) => x.startsWith(stem) && x.endsWith(".onnx")) ?? `${stem}.onnx`);
      const refs = fs.existsSync(f("test_wavs")) ? fs.readdirSync(f("test_wavs")).filter((x) => x.endsWith(".wav") && !x.includes("_fr_")).sort() : [];
      // Pocket TTS copies the voice of a short recording; the ones it comes with stand in for a voice Buddy would ship.
      voice(name, d, { pocket: { lmFlow: p("lm_flow"), lmMain: p("lm_main"), encoder: p("encoder"), decoder: p("decoder"), textConditioner: p("text_conditioner"), vocabJson: f("vocab.json"), tokenScoresJson: f("token_scores.json") } }, { voices: refs.map((r) => ({ sid: 0, label: r.replace(/\.wav$/, ""), lang: "en es", reference: f(path.join("test_wavs", r)) })) });
    } else if (name.includes("supertonic")) {
      voice(name, d, supertonic(d), { steps: 5, voices: SUPERTONIC_VOICES });
    } else if (name.startsWith("vits-")) {
      voice(name, d, { vits: { model: f(onnx), tokens: f("tokens.txt"), dataDir: f("espeak-ng-data") } });
    } else if (name.startsWith("matcha")) {
      voice(name, d, { matcha: { acousticModel: f(onnx), vocoder: f("vocos-22khz-univ.onnx"), tokens: f("tokens.txt"), dataDir: f("espeak-ng-data") } });
    }
  }
  if (installed && fs.existsSync(path.join(installed, "vocoder.int8.onnx"))) voice("supertonic-3 (Buddy today)", installed, supertonic(installed), { steps: 5, voices: SUPERTONIC_VOICES });
  return found;
}
// Supertonic speaks every language with each of its ten voices (Settings numbers them 0-9; 0 is Buddy's default).
const SUPERTONIC_VOICES = Array.from({ length: 10 }, (_, sid) => ({ sid, label: `voice ${sid}`, lang: "en es" }));

function supertonic(d) {
  const f = (x) => path.join(d, x);
  return { supertonic: { durationPredictor: f("duration_predictor.int8.onnx"), textEncoder: f("text_encoder.int8.onnx"), vectorEstimator: f("vector_estimator.int8.onnx"), vocoder: f("vocoder.int8.onnx"), ttsJson: f("tts.json"), unicodeIndexer: f("unicode_indexer.bin"), voiceStyle: f("voice.bin") } };
}

const folderMB = (d) => Math.round(fs.readdirSync(d, { recursive: true }).reduce((n, x) => {
  const s = fs.statSync(path.join(d, String(x)));
  return n + (s.isFile() ? s.size : 0);
}, 0) / 1e6);

function wav(file, samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

function readWav(file) {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  const channels = b.readUInt16LE(22);
  let at = 12;
  while (b.toString("ascii", at, at + 4) !== "data") at += 8 + b.readUInt32LE(at + 4);
  const n = b.readUInt32LE(at + 4) / (bits / 8) / channels;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = bits === 16 ? b.readInt16LE(at + 8 + i * 2 * channels) / 32768 : b.readFloatLE(at + 8 + i * 4 * channels);
  return { samples: out, rate };
}

/**
 * How clearly a sample says its sentence: Buddy's own listening model (Moonshine) transcribes it, and the score is the
 * share of the sentence's words it heard. Null when Moonshine isn't installed.
 */
function listener(sherpa, models) {
  const dir = path.join(models, "sherpa-onnx-moonshine-base-en-quantized-2026-02-27");
  const multi = path.join(models, "sherpa-onnx-whisper-base");
  if (!fs.existsSync(path.join(dir, "tokens.txt"))) return null;
  const f = (x) => path.join(dir, x);
  const m = (x) => path.join(multi, x);
  const recognizer = (engine) => new sherpa.OfflineRecognizer({ featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { ...engine, numThreads: THREADS, provider: "cpu", debug: 0 } });
  const asr = recognizer({ moonshine: { encoder: f("encoder_model.ort"), mergedDecoder: f("decoder_model_merged.ort") }, tokens: f("tokens.txt") });
  // Spanish is scored by the multilingual Whisper Buddy downloads for "Detect automatically", when it's there.
  const es = fs.existsSync(m("base-tokens.txt")) ? recognizer({ whisper: { encoder: m("base-encoder.int8.onnx"), decoder: m("base-decoder.int8.onnx"), language: "es", task: "transcribe", tailPaddings: -1 }, tokens: m("base-tokens.txt") }) : null;
  const words = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  return (samples, rate, text, lang = "en") => {
    const engine = lang === "es" ? es : asr;
    if (!engine) return {};
    const stream = engine.createStream();
    stream.acceptWaveform({ samples, sampleRate: rate });
    engine.decode(stream);
    const heard = String(engine.getResult(stream).text ?? "").trim();
    const want = words(text);
    const got = new Set(words(heard));
    return { heard, clarity: +(want.filter((w) => got.has(w)).length / want.length).toFixed(2) };
  };
}

/** In the child: load one model, warm it, then time every sentence in each of its voices. */
async function measure(c, out, models) {
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node");
  const before = process.memoryUsage().rss;
  let t = performance.now();
  const tts = new sherpa.OfflineTts({ model: { ...c.model, numThreads: THREADS, provider: "cpu", debug: false }, maxNumSentences: 1 });
  const loadMs = performance.now() - t;
  const config = (v, lang) => ({
    sid: v.sid,
    speed: 1,
    ...(c.steps && { numSteps: c.steps }),
    ...(v.ref && { referenceAudio: v.ref.samples, referenceSampleRate: v.ref.rate }),
    extra: { lang },
  });
  const voices = (c.voices ?? [{ sid: 0, label: "default" }]).map((v) => ({ ...v, ref: v.reference ? readWav(v.reference) : null }));
  // The first run sets up the engine; Buddy warms it the same way.
  await tts.generateAsync({ text: "Hello.", enableExternalBuffer: false, generationConfig: config(voices[0], "en") });
  const memMB = Math.round((process.memoryUsage().rss - before) / 1e6);
  const hear = listener(sherpa, models);
  const results = [];
  for (const v of voices) {
    const langs = (v.lang ?? "en").split(" ");
    const rows = [];
    for (const s of SENTENCES) {
      const lang = s.lang ?? "en";
      if (!langs.includes(lang)) continue;
      t = performance.now();
      const audio = await tts.generateAsync({ text: s.text, enableExternalBuffer: false, generationConfig: config(v, lang) });
      const ms = performance.now() - t;
      const seconds = audio.samples.length / audio.sampleRate;
      const slug = `${c.slug}-${v.label.replace(/[^a-z0-9_-]+/gi, "-")}`;
      wav(path.join(out, `${slug}-${s.id}.wav`), audio.samples, audio.sampleRate);
      rows.push({ id: s.id, file: `${slug}-${s.id}.wav`, ms: Math.round(ms), seconds: +seconds.toFixed(2), rtf: +(ms / 1000 / seconds).toFixed(3), ...(hear && hear(audio.samples, audio.sampleRate, s.text, lang)) });
    }
    results.push({ name: c.name, voice: v.label, loadMs: Math.round(loadMs), memMB, diskMB: folderMB(c.dir), rate: tts.sampleRate, rows });
  }
  return results;
}

/** The averages that decide it, per voice. */
export function summary(r) {
  const mean = (rows) => (rows.length ? +(rows.reduce((n, x) => n + x.clarity, 0) / rows.length).toFixed(2) : null);
  const scored = r.rows.filter((x) => x.clarity != null);
  return {
    firstMs: r.rows.find((x) => x.id === "step")?.ms ?? null,
    rtf: +(r.rows.reduce((n, x) => n + x.rtf, 0) / r.rows.length).toFixed(2),
    clarity: mean(scored.filter((x) => x.id !== "es")),
    clarityEs: mean(scored.filter((x) => x.id === "es")),
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(results) {
  const cell = (r, id) => {
    const row = r.rows?.find((x) => x.id === id);
    return row ? `<td><audio controls preload="none" src="${row.file}"></audio><br><small>${row.ms} ms for ${row.seconds} s${row.heard != null ? `<br>heard: “${esc(row.heard)}”` : ""}</small></td>` : "<td>—</td>";
  };
  return `<!doctype html><meta charset="utf-8"><title>Buddy voices</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px;vertical-align:top;font-weight:normal}th{text-align:left}audio{width:190px}small{color:#555}</style>
<h1>Buddy voices</h1><p>Made on this PC, ${THREADS} threads, after one warm-up. <b>First sentence</b>: how long Buddy waits before the first
word of a short step. <b>Speed</b>: time to make the audio over its length (lower is faster). <b>Clarity</b>: the share of
each English sentence's words that Buddy's own listening model heard back.</p>
<table><tr><th>Model</th><th>Voice</th><th>First sentence</th><th>Speed</th><th>Clarity</th><th>Clarity (Spanish)</th><th>Memory</th><th>Download</th>${SENTENCES.map((s) => `<th>${esc(s.text)}</th>`).join("")}</tr>
${results.map((r) => {
  if (r.error) return `<tr><td>${esc(r.name)}</td><td colspan="${7 + SENTENCES.length}">${esc(r.error)}</td></tr>`;
  const s = summary(r);
  return `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.voice)}</td><td>${s.firstMs} ms</td><td>${s.rtf}×</td><td>${s.clarity ?? "—"}</td><td>${s.clarityEs ?? "—"}</td><td>${r.memMB} MB</td><td>${r.diskMB} MB</td>${SENTENCES.map((x) => cell(r, x.id)).join("")}</tr>`;
}).join("\n")}
</table>`;
}

const me = fileURLToPath(import.meta.url);
if (process.argv[2] === "--child") {
  const { c, out, models } = JSON.parse(process.argv[3]);
  measure(c, out, models).then((r) => process.send?.(r), (err) => process.send?.([{ name: c.name, error: String(err?.message ?? err) }])).finally(() => process.exit(0));
} else if (path.resolve(process.argv[1] ?? "") === me) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/voice-bench.mjs <folder of unpacked voices> [--out <folder>]");
    process.exit(2);
  }
  const outAt = process.argv.indexOf("--out");
  const out = path.resolve(outAt > 0 ? process.argv[outAt + 1] : path.join(dir, "results"));
  fs.mkdirSync(out, { recursive: true });
  // Buddy's installed models: today's voice to compare against, and the listening model that scores clarity.
  const models = path.join(process.env.APPDATA ?? os.homedir(), "desktop-buddy", "models");
  const results = [];
  for (const c of candidates(dir, path.join(models, "sherpa-onnx-supertonic-3-tts-int8-2026-05-11"))) {
    c.slug = c.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/-+$/, "");
    console.log(c.name);
    const r = await new Promise((resolve) => {
      const child = fork(me, ["--child", JSON.stringify({ c, out, models })], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let err = "";
      child.stderr?.on("data", (d) => (err += d));
      const timer = setTimeout(() => child.kill(), 600_000);
      child.on("message", (m) => resolve(m));
      child.on("exit", (code) => (clearTimeout(timer), resolve([{ name: c.name, error: `stopped (${code}): ${err.trim().slice(-300)}` }])));
    });
    for (const v of r) {
      results.push(v);
      const s = v.error ? null : summary(v);
      console.log(s ? `  ${v.voice}: first sentence ${s.firstMs} ms, ${s.rtf}x, clarity ${s.clarity} (Spanish ${s.clarityEs ?? "-"}), ${v.memMB} MB` : `  failed: ${v.error}`);
    }
  }
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(out, "listen.html"), page(results));
  console.log(`\n${path.join(out, "listen.html")}`);
}
