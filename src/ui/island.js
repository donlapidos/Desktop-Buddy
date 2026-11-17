// The island (island.html): the status pill at the top of the screen, its task chips and their previews. A classic
// script, not a module. Type-checked with the rest of Buddy (tsconfig.json).
const $ = (id) => document.getElementById(id);
const zone = $("zone"), pill = $("pill"), label = $("label"), peek = $("peek");
const act = (a) => window.buddy.islandAction(a);
let state = "idle", idleTimer, tasks = [], peekId = null, peekTimer, leaveTimer;

zone.addEventListener("mouseenter", () => {
  clearTimeout(leaveTimer);
  window.buddy.islandHover(true);
  if (state === "idle") pill.classList.add("open");
});
// A short grace period, so moving from a chip down to its preview doesn't close it.
zone.addEventListener("mouseleave", () => {
  leaveTimer = setTimeout(() => {
    window.buddy.islandHover(false);
    pill.classList.remove("open");
    showPeek(null);
  }, 160);
});
// Main noticed the mouse is long gone (a missed mouseleave): settle as if it had left.
window.buddy.onIslandLeave(() => {
  clearTimeout(leaveTimer);
  pill.classList.remove("open");
  showPeek(null);
});
$("ask").addEventListener("click", () => act("ask"));
$("talk").addEventListener("click", () => act("talk"));
$("mark").addEventListener("click", () => act("mark"));
$("task").addEventListener("click", () => act("task"));
$("settings").addEventListener("click", () => act("settings"));

// A task chip's state, in words (translated where shown).
const STATE_WORDS = { idle: N("ready"), working: N("working"), confirm: N("needs your OK"), done: N("finished"), error: N("hit a problem") };
const stateWords = (state) => (STATE_WORDS[state] ? t(STATE_WORDS[state]) : state);

function showPeek(id) {
  clearTimeout(peekTimer);
  if (id === peekId) return;
  peekId = id;
  window.buddy.taskPeek(id);
  for (const c of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".chip"))) c.classList.toggle("peeking", c.dataset.id === id);
  if (!id) return peek.classList.remove("on");
  $("peek-img").removeAttribute("src");
  fillPeek();
  peek.classList.add("on");
}

function fillPeek() {
  const task = tasks.find((x) => x.id === peekId);
  if (!task) return showPeek(null);
  peek.dataset.state = task.state;
  $("peek-title").textContent = `${task.n} · ${task.title}`;
  $("peek-state").textContent = stateWords(task.state);
  $("peek-line").textContent = task.line ?? "";
  $("peek-show").textContent = task.open ? t("Tuck away") : t("Open");
}

window.buddy.onTaskPeek(({ id, src }) => {
  if (id === peekId && src) /** @type {HTMLImageElement} */ ($("peek-img")).src = src;
});
const onPeek = (verb) => () => peekId && act(`${verb}:${peekId}`);
$("peek-open").addEventListener("click", onPeek("task-open"));
$("peek-show").addEventListener("click", onPeek("task"));
$("peek-allow").addEventListener("click", onPeek("task-allow"));
$("peek-deny").addEventListener("click", onPeek("task-deny"));
$("peek-close").addEventListener("click", () => { onPeek("task-close")(); showPeek(null); });

window.buddy.onTasks((list) => {
  tasks = list;
  const box = $("chips");
  box.replaceChildren(...list.map((task) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (task.open ? " open" : "") + (task.id === peekId ? " peeking" : "");
    chip.dataset.state = task.state;
    chip.dataset.id = task.id;
    chip.setAttribute("aria-label", `${task.title}: ${stateWords(task.state)}`);
    chip.append(document.createElement("i"), String(task.n));
    chip.addEventListener("click", () => act("task:" + task.id));
    chip.addEventListener("mouseenter", () => { clearTimeout(peekTimer); peekTimer = setTimeout(() => showPeek(task.id), peekId ? 0 : 140); });
    return chip;
  }));
  box.classList.toggle("on", list.length > 0);
  if (peekId) fillPeek();
});
window.buddy.onIslandAttach((on) => document.body.classList.toggle("attached", on));
label.addEventListener("click", () => act(state === "speaking" ? "hush" : state === "idle" ? "ask" : "show"));
const hint = $("hint");

// The mic level while listening drives the meter: the middle bars move most.
const bars = [.../** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("#meter i"))];
window.buddy.onVoiceLevel((level) => {
  if (state !== "listening") return;
  bars.forEach((b, i) => (b.style.height = `${4 + Math.round(level * [7, 10, 9, 6][i] * (0.75 + Math.random() * 0.5))}px`));
});

window.buddy.onIsland(({ state: s, text, hotkey = "", talkKey = "", advanced = true }) => {
  // Without the advanced features, the island offers the core: Ask, Talk and Mark.
  document.body.classList.toggle("basic", !advanced);
  $("ask").title = hotkey;
  $("talk").title = t("{key}: say it instead of typing. Pause when you're done.", { key: talkKey });
  state = s;
  document.body.dataset.state = s;
  label.textContent = text || "Buddy";
  hint.textContent = s === "active" ? t("{key} to talk", { key: talkKey }) : s === "listening" ? t("{key} to send", { key: talkKey }) : s === "speaking" ? t("click to stop") : hotkey;
  if (s !== "listening") bars.forEach((b) => (b.style.height = ""));
  if (s !== "idle") pill.classList.remove("open");
  clearTimeout(idleTimer);
  if (s === "done") idleTimer = setTimeout(() => act("settle"), 4000);
});
