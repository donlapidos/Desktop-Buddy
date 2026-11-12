import assert from "node:assert/strict";
import { test } from "node:test";
import { findLocal, localDoor, memoryWords } from "../src/welcome.js";

const GB = 2 ** 30;

// A PC where Ollama answers with the given models and LM Studio isn't running.
const ollamaWith = (ids) => async (url) => {
  if (String(url).startsWith("http://localhost:11434/")) return new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }));
  throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
};

test("a running local server is found with its models, and one that isn't running is told apart", async () => {
  const [ollama, lmstudio] = await findLocal({ fetchImpl: ollamaWith(["qwen3:8b"]) });
  assert.deepEqual([ollama.id, ollama.running, ollama.models], ["ollama", true, ["qwen3:8b"]]);
  assert.deepEqual([lmstudio.id, lmstudio.running, lmstudio.models], ["lmstudio", false, []]);
});

test("the address the user gave a local server is the one checked", async () => {
  const asked = [];
  await findLocal({ urls: { lmstudio: "http://192.168.1.9:1234/v1" }, fetchImpl: async (url) => (asked.push(String(url)), new Response('{"data":[]}')) });
  assert.ok(asked.includes("http://192.168.1.9:1234/v1/models"));
});

test("a local server that never answers doesn't hold the welcome up", async () => {
  const t = Date.now();
  const found = await findLocal({ fetchImpl: () => new Promise(() => {}) });
  assert.ok(Date.now() - t < 4_000);
  assert.deepEqual(found.map((s) => s.running), [false, false]);
});

test("Free, on this PC offers a running server with models, and otherwise says what to do", async () => {
  const ready = localDoor(await findLocal({ fetchImpl: ollamaWith(["qwen3:8b", "llama3.2"]) }), 16 * GB);
  assert.deepEqual(ready.use, { id: "ollama", label: "Ollama", model: "qwen3:8b" });
  assert.match(ready.text, /Ollama is running .* 2 models.*nothing leaves this PC/);

  const empty = localDoor(await findLocal({ fetchImpl: ollamaWith([]) }), 16 * GB);
  assert.equal(empty.use, null);
  assert.match(empty.text, /running but has no models.*check again/);

  const none = localDoor(await findLocal({ fetchImpl: ollamaWith([]).bind(null, "http://nowhere/") }), 16 * GB);
  assert.equal(none.use, null);
  assert.match(none.text, /ollama\.com.*lmstudio\.ai.*Neither is running/);
});

test("the memory a local model needs is said against this PC's", () => {
  assert.match(memoryWords(32 * GB), /32 GB.*plenty/);
  assert.match(memoryWords(16 * GB), /16 GB.*enough, with other apps closed/);
  assert.match(memoryWords(8 * GB), /8 GB.*likely too little/);
});

import { appWords, tourNext, tourTip } from "../src/welcome.js";

test("the tour starts only at setup, goes ask then Mark, and never comes back once done or skipped", () => {
  assert.equal(tourNext("none", "answered"), "none", "a Buddy set up before the tour existed never sees it");
  assert.equal(tourNext("none", "setup"), "ask");
  assert.equal(tourNext("ask", "marked"), "ask", "Mark before asking doesn't skip the first step");
  assert.equal(tourNext("ask", "answered"), "mark");
  assert.equal(tourNext("mark", "answered"), "mark");
  assert.equal(tourNext("mark", "marked"), "done");
  assert.equal(tourNext("mark", "gotit"), "done");
  assert.equal(tourNext("ask", "skip"), "done");
  assert.equal(tourNext("done", "setup"), "done", "setting up again (a new key) doesn't restart it");
});

test("the tour's tips name the app in front and the user's own shortcuts", () => {
  const words = { ask: "Ctrl+Shift+Space", mark: "Ctrl+Alt+K", app: appWords({ app_name: "EXCEL.EXE", title: "Budget 2026 - Excel" }) };
  assert.match(tourTip("ask", words)?.text ?? "", /in Excel,.*Ctrl\+Shift\+Space/);
  assert.equal(tourTip("ask", words)?.event, "skip");
  assert.match(tourTip("mark", words)?.text ?? "", /Ctrl\+Alt\+K/);
  assert.equal(tourTip("mark", words)?.event, "gotit");
  assert.equal(tourTip("none", words), null);
  assert.equal(tourTip("done", words), null);
  assert.match(tourTip("ask", { ...words, app: null })?.text ?? "", /in the app you were using/);
});

test("an app is named as people say it", () => {
  assert.equal(appWords({ app_name: "EXCEL.EXE", title: "Budget 2026 - Excel" }), "Excel");
  assert.equal(appWords({ app_name: "msedge.exe", title: "Weather — Microsoft​ Edge" }), "Microsoft Edge");
  assert.equal(appWords({ app_name: "Notepad.exe", title: "Notepad" }), "Notepad");
  assert.equal(appWords({ app_name: "WindowsTerminal.exe", title: "Windows PowerShell" }), "Windows Terminal");
  assert.equal(appWords(null), null);
});
