// The Settings page (settings.html): renders the state main.js sends and sends back each change, through the preload's
// window.buddy. A classic script, not a module, so the dev checks can call its functions (show, render) by name.
// Type-checked with the rest of Buddy (tsconfig.json).
const $ = (id) => document.getElementById(id);
/** A text field, range or textarea by id. */
const $field = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
const el = (tag, props = {}, ...children) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const c of children) n.append(c);
  return n;
};
let S = null; // the latest state from main
let recording = null; // the shortcut being recorded
const problems = {};

// ---------- Navigation: one section at a time; the last one is remembered ----------
const pages = ["voice", "dictation", "look", "keys", "agents", "connections", "lessons", "routines", "claude", "activity", "about"];
const navButtons = () => /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("nav button"));
function show(page) {
  for (const p of pages) $(`page-${p}`).hidden = p !== page;
  for (const b of navButtons()) b.setAttribute("aria-current", b.dataset.page === page ? "page" : "false");
  try { localStorage.setItem("settings-page", page); } catch {}
  document.querySelector("main").scrollTop = 0;
  stopRecording();
}
for (const b of navButtons()) b.addEventListener("click", () => show(b.dataset.page));

async function set(patch) {
  const res = await window.buddy.settingsSet(patch);
  Object.assign(problems, Object.fromEntries(Object.keys(patch).flatMap((k) => (k === "hotkeys" ? Object.keys(patch.hotkeys).map((n) => [`hotkeys.${n}`, ""]) : [[k, ""]]))), res.problems);
  render(res.state);
  return res.problems;
}

const segmented = (box, options, value, onPick, disabled = false) => {
  box.replaceChildren(...options.map(([v, label]) => {
    const b = el("button", { textContent: label, disabled });
    b.setAttribute("aria-pressed", String(v === value));
    b.addEventListener("click", () => v !== value && onPick(v));
    return b;
  }));
};

// ---------- Voice ----------
let playingTimer;
function preview(sid, speed) {
  window.buddy.settingsPreview(sid, speed);
  for (const v of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".voice"))) v.classList.toggle("playing", Number(v.dataset.sid) === sid);
  clearTimeout(playingTimer);
  playingTimer = setTimeout(() => document.querySelectorAll(".voice").forEach((v) => v.classList.remove("playing")), 4500 / speed);
}

function renderVoice() {
  const s = S.settings;
  const box = $("voices");
  if (!box.children.length) {
    for (let sid = 0; sid < S.voices; sid++) {
      const b = el("button", { className: "voice" }, el("span", { className: "wave" }, el("i"), el("i"), el("i")), el("b", { textContent: String(sid) }));
      b.dataset.sid = String(sid);
      b.setAttribute("role", "radio");
      b.addEventListener("click", async () => {
        if (S.settings.voice !== sid) await set({ voice: sid });
        preview(sid, S.settings.speed);
      });
      box.append(b);
    }
  }
  for (const b of /** @type {HTMLCollectionOf<HTMLButtonElement>} */ (box.children)) {
    b.setAttribute("aria-label", t("Voice {n}", { n: b.dataset.sid }));
    b.setAttribute("aria-checked", String(Number(b.dataset.sid) === s.voice));
    b.disabled = S.fixed.voice;
  }
  $("voice-fixed").hidden = !S.fixed.voice;

  const r = $field("speed");
  Object.assign(r, { min: S.speed.min, max: S.speed.max, step: S.speed.step });
  if (document.activeElement !== r) r.value = s.speed;
  paintSpeed();

  const help = { spoken: t("Buddy answers out loud when you asked out loud, and stays quiet when you typed."), always: t("Buddy reads every answer aloud."), never: t("Buddy never speaks; answers stay in the chat.") };
  $("talkback-help").textContent = help[s.talkBack];
  segmented($("talkback"), [["spoken", t("When I speak")], ["always", t("Always")], ["never", t("Never")]], s.talkBack, (v) => set({ talkBack: v }));
}
function paintSpeed() {
  const r = $field("speed");
  const v = Number(r.value);
  $("speed-out").textContent = `${v.toFixed(2)}×`;
  r.style.setProperty("--fill", `${((v - S.speed.min) / (S.speed.max - S.speed.min)) * 100}%`);
}
$("speed").addEventListener("input", paintSpeed);
$("speed").addEventListener("change", async (e) => {
  await set({ speed: Number(/** @type {HTMLInputElement} */ (e.target).value) });
  preview(S.settings.voice, S.settings.speed);
});

// ---------- Look ----------
function renderLook() {
  const s = S.settings;
  $("swatches").replaceChildren(...Object.entries(S.accents).map(([id, a]) => {
    const b = el("button", { className: "swatch" }, el("i"), a.label);
    b.style.setProperty("--c", a.hex);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(id === s.accent));
    b.addEventListener("click", () => id !== s.accent && set({ accent: id }));
    return b;
  }));
  segmented($("appearance"), [["system", t("Match Windows")], ["light", t("Light")], ["dark", t("Dark")]], s.appearance, (v) => set({ appearance: v }), S.fixed.appearance);
  // Each language by its own name, so someone who can't read the current one can still find theirs.
  segmented($("ui-language"), [["auto", t("Match Windows")], ...Object.entries(S.uiLanguages)], s.uiLanguage, (v) => set({ uiLanguage: v }));
  $("appearance-fixed").hidden = !S.fixed.appearance;
}

// ---------- Shortcuts ----------
const DESCRIBE = { ask: N("Open or close the chat"), talk: N("Start talking; press again to send"), mark: N("Click to explain, or draw to ask"), explain: N("Explain whatever is under the pointer"), dictate: N("Type what you say into the app you're in") };
const KEY_LABEL = { Control: "Ctrl", Super: "Win", Alt: "Alt", Shift: "Shift", Up: "↑", Down: "↓", Left: "←", Right: "→", PageUp: "Page Up", PageDown: "Page Down" };
const caps = (accel) => accel.split("+").map((k) => el("kbd", { textContent: KEY_LABEL[k] ?? k }));

function renderKeys() {
  const box = $("keys");
  box.replaceChildren(...Object.keys(S.labels).map((name) => {
    const accel = S.settings.hotkeys[name];
    const fixed = S.fixed.hotkeys.includes(name);
    const cap = el("button", { className: "keycap", disabled: fixed });
    cap.setAttribute("aria-label", t("{name} shortcut: {keys}. Click to change.", { name: S.labels[name], keys: accel }));
    if (recording === name) {
      cap.classList.add("recording");
      cap.textContent = t("Press keys…");
    } else cap.append(...caps(accel));
    cap.addEventListener("click", () => (recording === name ? stopRecording() : startRecording(name)));
    const side = el("div", { className: "side" });
    if (!fixed && accel !== S.defaultHotkeys[name]) {
      const reset = el("button", { className: "link", textContent: t("Reset") });
      reset.addEventListener("click", () => set({ hotkeys: { [name]: S.defaultHotkeys[name] } }));
      side.append(reset);
    }
    side.append(cap);
    const taken = S.taken.includes(name) ? t("Another app has this shortcut, so it isn't working. Pick a different one.") : "";
    const note = fixed ? t("Set by an environment variable.") : problems[`hotkeys.${name}`] || taken;
    return el("div", { className: "key-row" },
      el("div", { className: "what" }, el("b", { textContent: S.labels[name] }), el("span", { textContent: DESCRIBE[name] ? t(DESCRIBE[name]) : "" })),
      side,
      el("p", { className: fixed ? "fixed" : "problem", textContent: note }));
  }));
}

// Accelerator text from a key press, in Electron's form: modifiers in a fixed order, then one key.
const CODE_KEYS = { Space: "Space", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
function accelerator(e) {
  let key = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(e.code)) key = e.code;
  else key = CODE_KEYS[e.code] ?? null;
  const mods = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  return { key, mods };
}

function startRecording(name) {
  recording = name;
  problems[`hotkeys.${name}`] = "";
  window.buddy.settingsCapture(true);
  renderKeys();
}
function stopRecording() {
  if (!recording) return;
  recording = null;
  window.buddy.settingsCapture(false);
  if (S) renderKeys();
}
addEventListener("keydown", async (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.key === "Escape") return stopRecording();
  if (["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key)) return;
  const { key, mods } = accelerator(e);
  const name = recording;
  if (!key) {
    problems[`hotkeys.${name}`] = t("That key can't be part of a shortcut. Try a letter, number or F-key.");
    return renderKeys();
  }
  if (!mods.some((m) => m !== "Shift")) {
    problems[`hotkeys.${name}`] = t("Add Ctrl, Alt or the Windows key, so the shortcut doesn't get in the way of typing.");
    return renderKeys();
  }
  recording = null;
  await set({ hotkeys: { [name]: [...mods, key].join("+") } });
  window.buddy.settingsCapture(false);
});
addEventListener("blur", stopRecording);

// ---------- Claude, privacy & startup ----------
let replacingKey = false;
let confirming = null; // "explainers" | "remove-key"
const EFFORT = { low: N("Low"), medium: N("Medium"), high: N("High") };

function renderClaude() {
  // A background update mustn't wipe a key being typed.
  if (document.activeElement?.id !== "key-input") renderKeyBox();
  if (document.activeElement?.id !== "address-input") renderAddress();
  renderClaudeRest();
}

// Ollama, LM Studio and other servers: where they are. Saving it asks the server for its models straight away.
function renderAddress() {
  const p = provider();
  $("address-group").hidden = !(p.local || p.key === "optional");
  if ($("address-group").hidden) return;
  const input = el("input", { className: "field", id: "address-input", type: "url", value: p.address ?? "", placeholder: p.defaultAddress ?? "https://example.com/v1", spellcheck: false });
  const save = el("button", { className: "btn primary", textContent: t("Save address") });
  const submit = async () => {
    if (!input.value.trim()) return;
    $("address-problem").textContent = "";
    const res = await window.buddy.settingsAddress(input.value);
    input.blur();
    $("address-problem").textContent = res.error ?? "";
    render(res.state);
  };
  save.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  const row = el("div", { className: "row" }, input, save);
  if (p.defaultAddress && p.address !== p.defaultAddress) {
    const reset = el("button", { className: "btn", textContent: t("Use the usual one") });
    reset.addEventListener("click", async () => render((await window.buddy.settingsAddress(p.defaultAddress)).state));
    row.append(reset);
  }
  const note = p.local
    ? t("Where {app} listens. The usual address works unless you changed it in {app}. Get {app} at {url}.", { app: p.label, url: p.keyFrom })
    : t("The server's address, ending in /v1 for most. Use https:// unless the server is on this PC or your local network.");
  $("address").replaceChildren(row, el("p", { className: "note", textContent: note }));
}

function renderKeyBox() {
  const box = $("key");
  box.replaceChildren();
  const p = provider();
  $("key-group").hidden = p.key === "none";
  $("key-title").textContent = p.key === "optional" ? t("API key (if the server needs one)") : t("API key");
  if (p.key === "none") return;
  if (S.key.fromEnv) {
    box.append(el("div", { className: "status" }, el("span", { className: "dot" }), t("Using {name} from the environment.", { name: S.key.env })));
  } else if (S.key.saved && !replacingKey) {
    const replace = el("button", { className: "btn", textContent: t("Replace key") });
    replace.addEventListener("click", () => { replacingKey = true; renderClaude(); $("key-input")?.focus(); });
    const actions = el("div", { className: "row" }, replace);
    if (confirming === "remove-key") {
      const yes = el("button", { className: "btn danger", textContent: t("Remove it") });
      const no = el("button", { className: "btn", textContent: t("Keep it") });
      yes.addEventListener("click", async () => { confirming = null; render(await window.buddy.settingsKeyRemove()); });
      no.addEventListener("click", () => { confirming = null; renderClaude(); });
      actions.replaceChildren(el("span", { textContent: t("Buddy will stop answering until you add a key.") }), yes, no);
    } else {
      const remove = el("button", { className: "btn danger", textContent: t("Remove") });
      remove.addEventListener("click", () => { confirming = "remove-key"; renderClaude(); });
      actions.append(remove);
    }
    box.append(el("div", { className: "status" }, el("span", { className: "dot" }), t("A key is saved, encrypted on this PC.")), actions);
  } else {
    const input = el("input", { className: "field", id: "key-input", type: "password", placeholder: provider().placeholder, autocomplete: "off", spellcheck: false });
    const save = el("button", { className: "btn primary", textContent: t("Save key") });
    const submit = async () => {
      if (!input.value.trim()) return;
      const res = await window.buddy.settingsKey(input.value);
      input.blur(); // so the box can redraw as "saved"
      input.value = "";
      $("key-problem").textContent = res.error ?? "";
      if (!res.error) replacingKey = false;
      render(res.state);
    };
    save.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
    const row = el("div", { className: "row" }, input, save);
    if (S.key.saved) {
      const cancel = el("button", { className: "btn", textContent: t("Cancel") });
      cancel.addEventListener("click", () => { replacingKey = false; $("key-problem").textContent = ""; renderClaude(); });
      row.append(cancel);
    }
    box.append(
      el("div", { className: `status${S.key.saved ? "" : " none"}` }, el("span", { className: "dot" }), S.key.saved ? t("Enter the new key.")
        : S.key.elsewhere ? t("The saved key is for {where}, so Buddy won't send it to this address. Enter this server's key, if it needs one.", { where: S.key.elsewhere })
        : provider().key === "optional" ? t("No key saved. Add one only if the server asks for it.") : t("No {provider} key yet. Buddy's own chat needs one; Use with your AI app, below, doesn't.", { provider: provider().label })),
      row,
      el("p", { className: "note", textContent: t("Get one at {url}. It's stored encrypted with Windows and never shown again.", { url: provider().keyFrom }) }),
    );
  }
}

const provider = () => S.providers.find((p) => p.id === S.settings.provider) ?? S.providers[0];

// The model check: short Buddy tasks on the chosen model, scored (main.js checkModel, evals.js).
function renderModelCheck() {
  const s = S.settings;
  const chosen = s.provider === "anthropic" ? s.model : s.providerModels[s.provider];
  const c = S.modelCheck && S.modelCheck.model === chosen && S.modelCheck.provider === s.provider ? S.modelCheck : null;
  const tested = S.tested;
  const button = el("button", { className: "btn", textContent: c?.running ? t("Stop") : tested ? t("Check again") : t("Check this model"), disabled: !chosen || !provider().ready });
  button.addEventListener("click", async () => render((await window.buddy.settingsCheckModel()).state));
  const status = c?.running ? t("Checking… {done} of {total} done, {passed} passed.", { done: c.done, total: c.total, passed: c.passed })
    : tested ? t("Passed {passed} of {total} tasks, about {s} s each.", { passed: tested.passed, total: tested.total, s: Math.max(1, Math.round(tested.avgMs / 1000)) })
    : "";
  $("model-check").replaceChildren(button, el("span", { className: "status-text", textContent: status }));
  $("model-check-note").textContent = c?.running ? t("Each task asks the model for help in a made-up Excel, Edge, Word, File Explorer or Notepad window, like you would.")
    : c?.stopped ? t("Stopped. Nothing was saved.")
    : c?.missed.length ? t("Missed: {tasks}.", { tasks: c.missed.join(", ") })
    : tested ? ""
    : provider().local ? t("Runs {n} short Buddy tasks on this model and scores them. Free, since it runs on this PC.", { n: S.checkTasks })
    : t("Runs {n} short Buddy tasks on this model and scores them. Uses a little of your account: about {requests} requests.", { n: S.checkTasks, requests: S.checkTasks * 2 });
}

function renderModel() {
  renderModelCheck();
  const s = S.settings;
  const own = s.provider !== "anthropic";
  $("models").hidden = own;
  $("provider-model").hidden = !own;
  const note = $("model-note");
  note.textContent = "";
  if (!own) return;
  const list = S.providerModels;
  const chosen = s.providerModels[s.provider] ?? "";
  const ids = list.models.length ? list.models : chosen ? [chosen] : [];
  const select = /** @type {HTMLSelectElement} */ ($("model-select"));
  select.disabled = S.fixed.model || !ids.length;
  const BADGE = { good: t("works well"), no_images: t("can't see images"), no_tools: t("can't use tools") };
  const v = (id) => list.verdicts?.[id] ?? "unknown";
  const label = (id) => [id, BADGE[v(id)], list.tested?.[id] && t("passed {passed}/{total}", { passed: list.tested[id].passed, total: list.tested[id].total })].filter(Boolean).join("  ·  ");
  select.replaceChildren(...ids.map((id) => el("option", { value: id, textContent: label(id), selected: id === chosen })));
  select.onchange = () => set({ providerModels: { [s.provider]: select.value } });
  note.textContent = list.loading ? t("Asking {provider} which models your key can use…", { provider: provider().label })
    : list.error ? list.error
    : !provider().ready ? (provider().key === "required" ? t("Save a key above to see the models it can use.") : t("Save the address above to see its models."))
    : { good: t("Works well with Buddy: it passed Buddy's checks, and it can use tools and see your screen."),
        capable: t("It can use tools and see your screen, but hasn't been checked with Buddy yet. Check this model to see how it does."),
        no_images: t("Can't see images, so Buddy reads your windows as text instead of screenshots. Guiding works; questions about pictures and charts won't."),
        no_tools: t("Can't use tools, so it can't read your screen or point. Pick another."),
      }[v(chosen)] ?? (provider().local ? t("Buddy doesn't know yet whether this model can use tools and see images; it finds out the first time you ask. Download models in {app}.", { app: provider().label }) : t("Buddy doesn't know yet whether this model can use tools and see images; it finds out the first time you ask."));
}

function renderClaudeRest() {
  const s = S.settings;
  $("screen-context").setAttribute("aria-checked", String(s.screenContext));
  $("hold-to-talk").setAttribute("aria-checked", String(s.holdToTalk));
  $("provider").replaceChildren(...S.providers.map((p) => {
    const b = el("button", { className: "model" }, el("span", { className: "radio" }), el("b", { textContent: p.label }), el("span", { textContent: p.note }));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(p.id === s.provider));
    b.addEventListener("click", () => {
      if (p.id === s.provider) return;
      replacingKey = false;
      $("key-problem").textContent = "";
      $("address-problem").textContent = "";
      set({ provider: p.id });
    });
    return b;
  }));
  renderModel();
  $("models").replaceChildren(...S.models.map((m) => {
    const b = el("button", { className: "model", disabled: S.fixed.model }, el("span", { className: "radio" }), el("b", { textContent: m.label }), el("span", { textContent: m.note }));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(m.id === s.model));
    b.addEventListener("click", () => m.id !== s.model && set({ model: m.id }));
    return b;
  }));
  $("model-fixed").hidden = !S.fixed.model;
  // The quick model: off, or another of this provider's models.
  const quickIds = s.provider === "anthropic" ? S.models.map((m) => m.id) : S.providerModels.models;
  const quick = /** @type {HTMLSelectElement} */ ($("quick-model"));
  const quickNow = s.quickModels[s.provider] ?? "";
  quick.replaceChildren(
    el("option", { value: "", textContent: t("Off: the model above answers everything"), selected: !quickNow }),
    ...quickIds.map((id) => el("option", { value: id, textContent: S.models.find((m) => m.id === id)?.label ?? id, selected: id === quickNow })),
  );
  quick.disabled = !quickIds.length;
  quick.onchange = () => set({ quickModels: { [s.provider]: quick.value } });
  segmented($("effort"), S.efforts.map((e) => [e, EFFORT[e] ? t(EFFORT[e]) : e[0].toUpperCase() + e.slice(1)]), s.effort, (v) => set({ effort: v }), S.fixed.effort);
  $("effort-fixed").hidden = !S.fixed.effort;

  $("startup").setAttribute("aria-checked", String(S.startsWithWindows));
  renderClaudeApps();

  const n = S.data.explainers;
  $("explainers-count").textContent = ` ${n === 1 ? t("1 plate, in your data folder.") : n ? t("{n} plates, in your data folder.", { n }) : t("None yet.")}`;
  const ex = $("explainers-actions");
  if (confirming === "explainers") {
    const yes = el("button", { className: "btn danger", textContent: t("Delete {n}", { n }) });
    const no = el("button", { className: "btn", textContent: t("Keep") });
    yes.addEventListener("click", async () => { confirming = null; render(await window.buddy.settingsClear("explainers")); });
    no.addEventListener("click", () => { confirming = null; renderClaude(); });
    ex.replaceChildren(yes, no);
  } else {
    const clear = el("button", { className: "btn", textContent: t("Clear…"), disabled: !n });
    clear.addEventListener("click", () => { confirming = "explainers"; renderClaude(); });
    ex.replaceChildren(clear);
  }
  const c = S.data.conversations;
  $("conversations-count").textContent = ` ${c === 1 ? t("One conversation, in words only (no screenshots), so they carry on after Buddy restarts. Closing a task forgets it.")
    : c ? t("{n} conversations, in words only (no screenshots), so they carry on after Buddy restarts. Closing a task forgets it.", { n: c })
    : t("None kept. What you ask and Buddy's replies are kept, in words only, so they carry on after Buddy restarts.")}`;
  const forget = el("button", { className: "btn", textContent: t("Forget"), disabled: !c });
  forget.addEventListener("click", async () => render(await window.buddy.settingsClear("conversations")));
  $("conversations-actions").replaceChildren(forget);
  const kb = S.data.logBytes;
  const size = kb < 1024 ? t("{n} bytes", { n: kb }) : t("{n} KB", { n: Math.round(kb / 1024) });
  $("log-size").textContent = ` ${kb ? t("Timings of each step, {size}; no screen content.", { size }) : t("Empty.")}`;
  const clearLog = el("button", { className: "btn", textContent: t("Clear"), disabled: !kb });
  clearLog.addEventListener("click", async () => render(await window.buddy.settingsClear("log")));
  $("log-actions").replaceChildren(clearLog);
}
let claudeBusy = null;

function renderClaudeApps() {
  // Apps on this PC first, in the usual order; the rest after, dimmed.
  const apps = [...S.aiApps].sort((a, b) => Number(S.claude[a.id] === "missing") - Number(S.claude[b.id] === "missing"));
  $("claude-apps").replaceChildren(...apps.map((a) => {
    const status = S.claude[a.id];
    const text = status === "added" ? `${t("Added.")} ${a.after}` : status === "missing" ? t("Not on this PC.") : t("Not added yet.");
    const btn = el("button", {
      className: status === "added" ? "btn" : "btn primary",
      textContent: claudeBusy === a.id ? t("Working…") : status === "added" ? t("Remove") : t("Add Buddy"),
      disabled: status === "missing" || !!claudeBusy,
    });
    btn.addEventListener("click", async () => {
      claudeBusy = a.id;
      renderClaudeApps();
      const res = await window.buddy.settingsClaude(a.id, status !== "added");
      claudeBusy = null;
      $("claude-problem").textContent = res.error ?? "";
      render(res.state);
    });
    const row = el("div", { className: "data-row" }, el("div", {}, el("b", { textContent: a.label }), el("span", { textContent: ` ${text}` })), btn);
    if (status === "missing") row.classList.add("dim");
    return row;
  }));
}

$("startup").addEventListener("click", async () => render(await window.buddy.settingsStartup(!S.startsWithWindows)));
$("open-data").addEventListener("click", () => window.buddy.settingsOpenData());

// ---------- Dictation ----------
function renderDictation() {
  const s = S.settings;
  $("dictate-key").replaceChildren(...caps(s.hotkeys.dictate));
  const stopHelp = { pause: t("Buddy types what you said as soon as you pause. Good for a sentence or two."), press: t("Keep talking through pauses; each sentence is typed as you go. Press the shortcut again to stop.") };
  $("dictate-stop-help").textContent = stopHelp[s.dictateStop];
  segmented($("dictate-stop"), [["pause", t("When I pause")], ["press", t("When I press it again")]], s.dictateStop, (v) => set({ dictateStop: v }));
  const langHelp = { en: t("Fastest, and the most accurate for English."), auto: t("Understands about 99 languages and works out which one you're speaking. Downloads a 160 MB model the first time.") };
  $("language-help").textContent = langHelp[s.language];
  segmented($("language"), [["en", t("English")], ["auto", t("Detect automatically")]], s.language, (v) => set({ language: v }));
}
$("dictate-change").addEventListener("click", () => show("keys"));

// ---------- Agents ----------
const ROPES = [
  ["ask", N("Nothing: ask every time"), N("Every click, keystroke and window move waits for your OK. The safest.")],
  ["safe", N("Make safe moves"), N("Scroll, expand and collapse, and move windows without asking. Anything that clicks, types or opens an app still asks.")],
  ["trusted", N("Act freely in apps I trust"), N("In your trusted apps, agents act without asking. Everywhere else, safe moves only.")],
];
const X = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("class", "i");
  svg.innerHTML = '<path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"/>';
  return svg;
};
function appChips(box, key) {
  box.replaceChildren(...S.settings[key].map((name) => {
    const remove = el("button", { title: t("Remove {name}", { name }) }, X());
    remove.setAttribute("aria-label", t("Remove {name}", { name }));
    remove.addEventListener("click", () => set({ [key]: S.settings[key].filter((x) => x !== name) }));
    return el("span", { className: "app-chip" }, name, remove);
  }));
}
function addApp(inputId, key) {
  const input = $field(inputId);
  const name = input.value.trim();
  if (!name) return;
  input.value = "";
  if (!S.settings[key].some((x) => x.toLowerCase() === name.toLowerCase())) set({ [key]: [...S.settings[key], name] });
}
for (const [inputId, key] of [["trusted-input", "trustedApps"], ["blocked-input", "blockedApps"]]) {
  $(inputId).addEventListener("keydown", (e) => e.key === "Enter" && addApp(inputId, key));
}
$("trusted-add").addEventListener("click", () => addApp("trusted-input", "trustedApps"));
$("blocked-add").addEventListener("click", () => addApp("blocked-input", "blockedApps"));

$("commands").addEventListener("click", () => set({ commands: !S.settings.commands }));
$("screen-context").addEventListener("click", () => set({ screenContext: !S.settings.screenContext }));
$("hold-to-talk").addEventListener("click", () => set({ holdToTalk: !S.settings.holdToTalk }));
$("advanced").addEventListener("click", () => set({ advanced: !S.settings.advanced }));
function renderAgents() {
  const s = S.settings;
  $("commands").setAttribute("aria-checked", String(s.commands));
  $("rope").replaceChildren(...ROPES.map(([id, label, note]) => {
    const b = el("button", { className: "model" }, el("span", { className: "radio" }), el("b", { textContent: t(label) }), el("span", { textContent: t(note) }));
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(id === s.rope));
    b.addEventListener("click", () => id !== s.rope && set({ rope: id }));
    return b;
  }));
  $("trusted-group").classList.toggle("muted-group", s.rope !== "trusted");
  $("trusted-help").textContent = s.rope === "trusted"
    ? t("Agents act in these without asking. Add only apps where a mistake is easy to undo.")
    : t("Used only with “Act freely in apps I trust”.");
  appChips($("trusted"), "trustedApps");
  appChips($("blocked"), "blockedApps");
  renderFolders();
}

// Folders read without asking: shown by their name in the home folder ("Documents"), in full elsewhere.
function folderName(dir) {
  const home = S.folders.home.toLowerCase();
  return dir.toLowerCase().startsWith(`${home}\\`) ? dir.slice(home.length + 1) : dir;
}
function renderFolders() {
  const { list, usual } = S.folders;
  $("folders").replaceChildren(...list.map((dir) => {
    const name = folderName(dir);
    const remove = el("button", { title: t("Remove {name}", { name }) }, X());
    remove.setAttribute("aria-label", t("Remove {name}", { name }));
    remove.addEventListener("click", () => set({ readFolders: list.filter((x) => x !== dir) }));
    return el("span", { className: "app-chip", title: dir }, name, remove);
  }));
  $("folders-usual").hidden = usual;
}
$("folder-add").addEventListener("click", async () => {
  const { error, state } = await window.buddy.settingsAddFolder();
  render(state);
  $("folder-problem").textContent = error ?? "";
});
$("folders-usual").addEventListener("click", () => {
  $("folder-problem").textContent = "";
  set({ readFolders: null });
});
// Suggest the apps open right now.
window.buddy.settingsApps().then((apps) => $("running-apps").replaceChildren(...apps.map((a) => el("option", { value: a.replace(/\.exe$/i, "") })))).catch(() => {});

// ---------- Routines ----------
let editing = null; // the routine being edited (a copy), or null
let deleting = null;
const DAY = [N("Sun"), N("Mon"), N("Tue"), N("Wed"), N("Thu"), N("Fri"), N("Sat")];
const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const when = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

function renderRoutines() {
  const list = S.settings.routines;
  const box = $("routines");
  if (!list.length) {
    box.replaceChildren(el("div", { className: "empty", textContent: t("No routines yet. For example: “Every weekday at 9:00, summarise my unread email and list anything urgent.”") }));
  } else {
    box.replaceChildren(...list.map((r) => {
      const info = S.routineInfo[r.id] ?? {};
      const toggle = el("button", { className: "switch" });
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", String(r.enabled));
      toggle.setAttribute("aria-label", r.enabled ? t("{name}: on", { name: r.name }) : t("{name}: off", { name: r.name }));
      toggle.addEventListener("click", () => set({ routines: list.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)) }));
      const actions = el("div", { className: "actions" });
      if (deleting === r.id) {
        const yes = el("button", { className: "btn danger", textContent: t("Delete it") });
        const no = el("button", { className: "btn", textContent: t("Keep it") });
        yes.addEventListener("click", () => { deleting = null; set({ routines: list.filter((x) => x.id !== r.id) }); });
        no.addEventListener("click", () => { deleting = null; renderRoutines(); });
        actions.append(yes, no);
      } else {
        const run = el("button", { className: "btn", textContent: t("Run now"), disabled: !S.key.saved && !S.key.fromEnv });
        run.addEventListener("click", async () => {
          const res = await window.buddy.settingsRunRoutine(r.id);
          $("routine-problem").textContent = res.error ?? "";
          render(res.state);
        });
        const edit = el("button", { className: "btn", textContent: t("Edit") });
        edit.addEventListener("click", () => { editing = structuredClone(r); renderRoutines(); });
        const del = el("button", { className: "btn danger", textContent: t("Delete") });
        del.addEventListener("click", () => { deleting = r.id; renderRoutines(); });
        actions.append(run, edit, del);
      }
      const next = r.enabled && info.next ? ` · ${t("next {when}", { when: when(info.next) })}` : r.enabled ? "" : ` · ${t("off")}`;
      return el("div", { className: "routine" },
        el("div", {}, el("b", { textContent: r.name }), el("div", { className: "when", textContent: `${info.schedule ?? ""}${next}` })),
        toggle,
        el("div", { className: "status", textContent: info.status ?? "" }),
        actions);
    }));
  }
  renderEditor();
  $("routine-new").hidden = !!editing;
}

function renderEditor() {
  const box = $("routine-editor");
  if (!editing) return box.replaceChildren();
  const r = editing;
  const name = el("input", { className: "field", value: r.name, placeholder: t("Morning inbox"), maxLength: 60 });
  name.addEventListener("input", () => (r.name = name.value));
  const prompt = el("textarea", { value: r.prompt, placeholder: t("Summarise my unread email in Outlook and list anything urgent."), maxLength: 2000 });
  prompt.addEventListener("input", () => (r.prompt = prompt.value));
  const every = el("div", { className: "seg" });
  segmented(every, [["day", t("Every day")], ["weekday", t("Weekdays")], ["week", t("Some days")], ["hours", t("Every few hours")]], r.schedule.every, (v) => { r.schedule.every = v; renderEditor(); });
  const time = el("input", { type: "time", value: r.schedule.time });
  time.addEventListener("change", () => (r.schedule.time = time.value || "09:00"));
  const detail = el("div", { className: "row" }, el("span", { textContent: r.schedule.every === "hours" ? t("Starting at") : t("At") }), time);
  if (r.schedule.every === "hours") {
    const hours = el("select", {}, ...[1, 2, 3, 4, 6, 8, 12].map((h) => el("option", { value: String(h), textContent: h === 1 ? t("every hour") : t("every {n} hours", { n: h }), selected: h === r.schedule.hours })));
    hours.addEventListener("change", () => (r.schedule.hours = Number(hours.value)));
    detail.append(hours);
  }
  const parts = [el("label", {}, t("Name"), name), el("label", {}, t("What should Buddy do?"), prompt), el("label", {}, t("When"), every), detail];
  if (r.schedule.every === "week") {
    parts.push(el("div", { className: "days" }, ...DAY.map((d, i) => {
      const b = el("button", { textContent: t(d) });
      b.setAttribute("aria-pressed", String(r.schedule.days.includes(i)));
      b.addEventListener("click", () => {
        r.schedule.days = r.schedule.days.includes(i) ? r.schedule.days.filter((x) => x !== i) : [...r.schedule.days, i].sort();
        renderEditor();
      });
      return b;
    })));
  }
  const save = el("button", { className: "btn primary", textContent: t("Save routine") });
  const cancel = el("button", { className: "btn", textContent: t("Cancel") });
  const problem = el("p", { className: "problem" });
  save.addEventListener("click", async () => {
    if (!r.prompt.trim()) return (problem.textContent = t("Say what Buddy should do."));
    if (r.schedule.every === "week" && !r.schedule.days.length) return (problem.textContent = t("Pick at least one day."));
    const list = S.settings.routines;
    const next = list.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [...list, r];
    editing = null;
    const problems = await set({ routines: next });
    $("routine-problem").textContent = problems.routines ? t("That routine couldn't be saved. You can have up to 20.") : "";
  });
  cancel.addEventListener("click", () => { editing = null; renderRoutines(); });
  box.replaceChildren(el("div", { className: "editor" }, ...parts, problem, el("div", { className: "row" }, save, cancel)));
}
$("routine-new").addEventListener("click", () => {
  editing = { id: newId(), name: "", prompt: "", schedule: { every: "weekday", time: "09:00", days: [1], hours: 4 }, enabled: true, lastRun: null };
  renderRoutines();
});

$("feature").addEventListener("click", () => window.buddy.settingsFeature());

// Report a problem: shown in full first; sent only by one of the two buttons, exactly as shown.
async function openReport() {
  const report = await window.buddy.settingsReport();
  $field("report-text").value = report.body;
  $("report-status").textContent = "";
  $("report-preview").hidden = false;
  $("report-text").scrollIntoView({ block: "nearest" });
}
$("report").addEventListener("click", openReport);
$("report-cancel").addEventListener("click", () => { $("report-preview").hidden = true; });
const sendReport = async (how) => {
  const r = await window.buddy.settingsReportSend(how, $field("report-text").value);
  $("report-status").textContent = how === "copy" ? t("Copied. Paste it wherever you'd like to send it.")
    : r.copied ? t("GitHub is open in your browser. The report was too long for the link, so it's copied: paste it into the issue.")
    : t("GitHub is open in your browser with the report filled in. Nothing is posted until you submit it there.");
};
$("report-issue").addEventListener("click", () => sendReport("issue"));
$("report-copy").addEventListener("click", () => sendReport("copy"));
$("plus").addEventListener("click", () => window.buddy.settingsPlus());
// Changes made elsewhere (the tray, a routine running) arrive here too.
window.buddy.onSettingsChanged((state) => render(state));

// ---------- About & updates ----------
function renderAbout() {
  const u = S.updates;
  $("about-version").textContent = `Desktop Buddy ${u?.version ?? ""}`;
  const when = u?.checkedAt ? ` ${t("Last checked {when}.", { when: new Date(u.checkedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) })}` : "";
  const status = {
    source: t("Running from source: update with git."),
    idle: t("Not checked yet."),
    checking: t("Checking for updates…"),
    downloading: t("Downloading {version}… {pct}%", { version: u?.next ?? t("the new version"), pct: u?.progress ?? 0 }),
    ready: t("Version {version} is downloaded. It installs when Buddy restarts.", { version: u?.next }),
    current: `${t("You have the latest version.")}${when}`,
    error: `${u?.error ?? t("Couldn't check")}.${when}`,
  }[u?.status ?? "source"];
  $("update-status").textContent = status;
  const actions = $("update-actions");
  actions.replaceChildren();
  if (u?.status === "ready") {
    const restart = el("button", { className: "btn primary", textContent: t("Restart and update") });
    restart.addEventListener("click", () => window.buddy.settingsUpdateInstall());
    actions.append(restart);
  } else if (u && u.status !== "source") {
    const check = el("button", { className: "btn", textContent: t("Check now"), disabled: u.status === "checking" || u.status === "downloading" });
    check.addEventListener("click", () => window.buddy.settingsUpdateCheck());
    actions.append(check);
  }
  const sw = /** @type {HTMLButtonElement} */ ($("auto-update"));
  sw.setAttribute("aria-checked", String(S.settings.autoUpdate));
  sw.disabled = u?.status === "source";
}
$("auto-update").addEventListener("click", () => set({ autoUpdate: !S.settings.autoUpdate }));
$("releases").addEventListener("click", () => window.buddy.settingsReleases());
$("notices").addEventListener("click", () => window.buddy.settingsNotices());

// ---------- Everything ----------
function render(state) {
  S = state;
  // Without the advanced features, Settings shows no routines.
  document.body.classList.toggle("basic", !S.settings.advanced);
  $("advanced").setAttribute("aria-checked", String(S.settings.advanced));
  renderVoice();
  renderDictation();
  renderLook();
  renderKeys();
  renderAgents();
  if (!editing) renderRoutines();
  renderClaude();
  renderSpend();
  renderActivity();
  renderLessons();
  renderConnections();
  renderAbout();
}

// ---------- Connections ----------
let connectingId = null;
let settingUpId = null; // a service that needs the user's own app (HubSpot), with its setup open
function renderConnections() {
  $("connections").replaceChildren(...(S.connections ?? []).map((c) => {
    if (c.returnUrl && (!c.setUp || settingUpId === c.id)) return setupRow(c);
    const info = el("div", {}, el("b", { textContent: c.label }), el("span", { className: "when", textContent: ` ${c.connected ? t("Connected: Buddy can {does}.", { does: c.does }) : t("Not connected.")}` }));
    const busy = connectingId === c.id;
    const btn = el("button", { className: c.connected ? "btn" : "btn primary", textContent: busy ? t("Signing in…") : c.connected ? t("Disconnect") : t("Connect"), disabled: !!connectingId });
    btn.setAttribute("aria-label", c.connected ? t("Disconnect {service}", { service: c.label }) : t("Connect {service}", { service: c.label }));
    btn.addEventListener("click", async () => {
      connectingId = c.connected ? null : c.id;
      $("connection-problem").textContent = c.connected ? "" : t("Sign in in your browser, then come back here.");
      renderConnections();
      const r = await window.buddy.settingsConnection(c.connected ? "disconnect" : "connect", c.id);
      connectingId = null;
      $("connection-problem").textContent = r.error ?? "";
      render(r.state);
    });
    const row = el("div", { className: "row" }, btn);
    if (c.returnUrl && !c.connected) {
      const change = el("button", { className: "btn", textContent: t("Change setup"), disabled: !!connectingId });
      change.setAttribute("aria-label", t("Change the {service} setup", { service: c.label }));
      change.addEventListener("click", () => ((settingUpId = c.id), renderConnections()));
      row.prepend(change);
    }
    return el("div", { className: "routine" }, info, row);
  }));
}

/** A service that only works with an app the user sets up in it: what to do there, the address to enter, its keys. */
function setupRow(/** @type {any} */ c) {
  const info = el("div", {}, el("b", { textContent: c.label }), el("span", { className: "when", textContent: ` ${t("Needs a one-time setup, then Buddy can {does}.", { does: c.does })}` }));
  const back = el("input", { className: "field", readOnly: true, value: c.returnUrl });
  back.setAttribute("aria-label", t("Return address for {service}", { service: c.label }));
  const copy = el("button", { className: "btn", textContent: t("Copy") });
  copy.addEventListener("click", async () => {
    back.select();
    try {
      await navigator.clipboard.writeText(c.returnUrl);
      copy.textContent = t("Copied");
    } catch {}
  });
  const id = el("input", { className: "field", placeholder: t("Client ID"), autocomplete: "off", spellcheck: false });
  const secret = el("input", { className: "field", type: "password", placeholder: t("Client secret"), autocomplete: "off" });
  id.setAttribute("aria-label", t("{service} Client ID", { service: c.label }));
  secret.setAttribute("aria-label", t("{service} Client secret", { service: c.label }));
  const save = el("button", { className: "btn primary", textContent: t("Save") });
  save.addEventListener("click", async () => {
    const r = await window.buddy.settingsConnection("setup", c.id, { clientId: id.value, clientSecret: secret.value });
    $("connection-problem").textContent = r.error ?? t("Saved. Choose Connect to sign in to {service}.", { service: c.label });
    if (!r.error) settingUpId = null;
    render(r.state);
  });
  const actions = el("div", { className: "row" }, save);
  if (c.setUp) {
    const cancel = el("button", { className: "btn", textContent: t("Cancel") });
    cancel.addEventListener("click", () => ((settingUpId = null), renderConnections()));
    actions.append(cancel);
  }
  const steps = el("div", { className: "setup" },
    el("p", { className: "hint", textContent: c.setup }),
    el("div", { className: "row" }, back, copy),
    el("div", { className: "row" }, id, secret),
    actions);
  return el("div", { className: "routine" }, info, steps);
}

// ---------- Lessons ----------
let deletingLesson = null;
function renderLessons() {
  const list = S.lessons ?? [];
  if (!list.length) {
    $("lessons").replaceChildren(el("p", { className: "empty", textContent: t("None yet. Ask Buddy how to do something; when it has walked you all the way through, choose Save as a lesson under its answer.") }));
    return;
  }
  $("lessons").replaceChildren(...list.map((l) => {
    const info = el("div", {}, el("b", { textContent: l.title }), el("span", { className: "when", textContent: ` ${l.app} · ${l.steps === 1 ? t("1 step") : t("{n} steps", { n: l.steps })}` }));
    const actions = el("div", { className: "row" });
    if (deletingLesson === l.id) {
      const yes = el("button", { className: "btn danger", textContent: t("Delete") });
      const no = el("button", { className: "btn", textContent: t("Keep") });
      yes.addEventListener("click", async () => { deletingLesson = null; render((await window.buddy.settingsLesson("delete", l.id)).state); });
      no.addEventListener("click", () => { deletingLesson = null; renderLessons(); });
      actions.append(yes, no);
    } else {
      const play = el("button", { className: "btn primary", textContent: t("Play") });
      play.setAttribute("aria-label", t("Play {title}", { title: l.title }));
      play.addEventListener("click", async () => {
        const r = await window.buddy.settingsLesson("play", l.id);
        $("lesson-problem").textContent = r.error ?? "";
      });
      const share = el("button", { className: "btn", textContent: t("Share…") });
      share.setAttribute("aria-label", t("Share {title} as a file", { title: l.title }));
      share.addEventListener("click", async () => {
        const r = await window.buddy.settingsLesson("export", l.id);
        $("lesson-problem").textContent = r.error ?? (r.saved ? t("Saved. Send that file to whoever you'd like to show.") : "");
      });
      const del = el("button", { className: "btn", textContent: t("Delete…") });
      del.setAttribute("aria-label", t("Delete {title}", { title: l.title }));
      del.addEventListener("click", () => { deletingLesson = l.id; renderLessons(); });
      actions.append(play, share, del);
    }
    return el("div", { className: "routine" }, info, actions);
  }));
}
$("lesson-import").addEventListener("click", async () => {
  const r = await window.buddy.settingsLessonImport();
  $("lesson-problem").textContent = r.error ?? (r.title ? t("Imported \"{title}\".", { title: r.title }) : "");
  render(r.state);
});

// ---------- Spending: the month so far, and the limit ----------
function renderSpend() {
  const sp = S.spend;
  if (!sp) return;
  $("spend-month").textContent = sp.month;
  $("spend-note").textContent = sp.note;
  if (document.activeElement !== $("cap")) $field("cap").value = S.settings.monthlyCap > 0 ? String(S.settings.monthlyCap) : "";
}
$("cap").addEventListener("change", async (e) => {
  const text = /** @type {HTMLInputElement} */ (e.target).value.trim();
  const v = text === "" ? 0 : Math.round(Number(text) * 100) / 100;
  const refused = !Number.isFinite(v) || v < 0 || (await set({ monthlyCap: v })).monthlyCap !== undefined;
  $("cap-problem").textContent = refused ? t("That limit wasn't saved: give an amount in dollars, up to 10,000, or leave it empty for none.") : "";
});

// ---------- Activity ----------
let undoing = null; // id of the change being undone
let confirmUndo = null; // id whose file changed since: the next click undoes anyway
const activityDay = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  return d.toDateString() === today.toDateString() ? t("Today") : d.toDateString() === yesterday.toDateString() ? t("Yesterday") : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
};
function renderActivity() {
  const list = S.activity ?? [];
  if (!list.length) {
    $("activity").replaceChildren(el("p", { className: "empty", textContent: t("Nothing yet. When Buddy makes or changes a file, runs a command, reads a page, or clicks or types in an app for you, it shows up here.") }));
    return;
  }
  const rows = [];
  let day = "";
  for (const e of list) {
    const d = activityDay(e.at);
    if (d !== day) rows.push(el("h3", { className: "day", textContent: (day = d) }));
    const time = new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const meta = [time, e.from !== "Buddy" ? e.from : null, e.undone ? t("undone") : null].filter(Boolean).join(" · ");
    const row = el("div", { className: `data-row activity-row${e.undone ? " dim" : ""}` }, el("div", {}, el("b", { textContent: e.summary }), el("span", { textContent: ` ${meta}` })));
    if (e.canUndo) {
      const again = confirmUndo === e.id;
      const btn = el("button", { className: again ? "btn danger" : "btn", textContent: undoing === e.id ? t("Undoing…") : again ? t("Undo anyway") : t("Undo"), disabled: !!undoing });
      btn.addEventListener("click", async () => {
        undoing = e.id;
        renderActivity();
        const res = await window.buddy.settingsUndo(e.id, again);
        undoing = null;
        confirmUndo = res.changed ? e.id : null;
        $("activity-problem").textContent = res.ok ? "" : res.message;
        render(res.state);
      });
      row.append(btn);
    } else if (!e.undone && (e.kind === "ran" || e.kind === "read" || e.kind === "acted")) {
      row.append(el("span", { className: "status-text", textContent: e.kind === "ran" ? t("Can't be undone automatically") : e.kind === "acted" ? t("Undo it in the app") : "" }));
    }
    rows.push(row);
  }
  $("activity").replaceChildren(...rows);
}

$("close").addEventListener("click", () => window.buddy.settingsClose());
$("min").addEventListener("click", () => window.buddy.settingsMinimize());
// Esc closes Settings, unless it was cancelling a shortcut being recorded (handled, and marked so, above).
addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented && /** @type {HTMLElement} */ (e.target).tagName !== "INPUT") window.buddy.settingsClose(); });

// Opened on a given page (the tray's "Recent changes…" opens Activity).
let requestedPage = null;
let reportWanted = false;
window.buddy.onSettingsShowPage?.((p) => {
  // The tray's "Report a problem…" opens About with the report ready to read.
  if (p === "report") {
    requestedPage = "about";
    reportWanted = true;
    if (S) { show("about"); openReport(); }
    return;
  }
  if (!pages.includes(p)) return;
  requestedPage = p;
  if (S) show(p);
});

// Redraw the words this script wrote when Buddy's words arrive or the language changes (nothing to redraw before S).
whenStrings(() => S && render(S));

(async () => {
  let page = "voice";
  try { page = pages.includes(localStorage.getItem("settings-page")) ? localStorage.getItem("settings-page") : "voice"; } catch {}
  render(await window.buddy.settingsState());
  show(requestedPage ?? page);
  if (reportWanted) openReport();
})();
