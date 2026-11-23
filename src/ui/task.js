// A task window (task.html): one agent's conversation, its steps and its approval card. A classic script, not a
// module. Type-checked with the rest of Buddy (tsconfig.json).
const $ = (id) => document.getElementById(id);
/** The question box, and the form that sends it. */
const $input = () => /** @type {HTMLTextAreaElement} */ ($("input"));
const $form = () => /** @type {HTMLFormElement} */ ($("form"));
const log = $("log");
let busy = false;
let turn = null; // the in-progress answer, where steps collect

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const scrollDown = () => (log.scrollTop = log.scrollHeight);
const addUser = (text) => { log.append(el("div", "user", text)); scrollDown(); };
const addBuddy = (text) => { log.append(el("div", "buddy", text)); scrollDown(); };

function setBusy(on) {
  busy = on;
  $("send").textContent = on ? t("Stop") : t("Ask");
  $("send").classList.toggle("ghost", on);
  $("log").setAttribute("aria-busy", String(on));
  $input().placeholder = on ? t("Working… (you can keep using your computer)") : t("Give this task a job…");
}

window.buddy.onTaskInit(({ n, title, target, transcript }) => {
  $("title").textContent = title;
  $("where").textContent = target ? t("Started in {window}", { window: target }) : t("Started from the island");
  for (const m of transcript) (m.role === "user" ? addUser : addBuddy)(m.text);
  $input().focus();
});

window.buddy.onTaskState(({ state, line, title }) => {
  document.body.dataset.state = state;
  if (title) $("title").textContent = title;
  if (line && turn && state !== "confirm") {
    const steps = turn.querySelector(".steps");
    if (steps.lastChild?.textContent !== line) steps.append(el("span", null, line));
    scrollDown();
  }
});

window.buddy.onTaskStream((text) => {
  if (!turn) return;
  let answer = turn.querySelector(".buddy");
  if (!answer) { answer = el("div", "buddy"); turn.append(answer); }
  answer.textContent = text;
  scrollDown();
});

// An approval takes a deliberate click. This window is often focused while the task works (you just typed in it),
// so nothing on the card takes focus, or the next Space or Enter would press Allow; and clicks in the card's first
// moments are ignored.
const ARM_MS = 500;
let confirmAt = 0;
// The card on screen: its number goes back with the answer, and its detail is the exact text, every character.
let cardId = 0;
window.buddy.onTaskConfirm(({ id, summary, note, detail }) => {
  cardId = id;
  $("what").textContent = summary;
  $("why").textContent = note && note.toLowerCase() !== summary.toLowerCase() ? note : "";
  $("exact").textContent = detail ?? "";
  $("exact").hidden = !detail;
  $("confirm").classList.add("on");
  confirmAt = performance.now();
  $("confirm").focus();
});
// A routine starts its task with a prompt, submitted as if typed.
window.buddy.onTaskPrompt((text) => {
  $input().value = text;
  $form().requestSubmit();
});
// Answered from the island's preview instead.
window.buddy.onTaskConfirmDone(() => $("confirm").classList.remove("on"));
$("confirm").addEventListener("click", (e) => {
  const d = /** @type {HTMLElement} */ (e.target).dataset?.d;
  if (!d || performance.now() - confirmAt < ARM_MS) return;
  $("confirm").classList.remove("on");
  window.buddy.taskConfirmReply(d, cardId);
});

$form().addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return window.buddy.taskCancel();
  const text = $input().value.trim();
  if (!text) return;
  $input().value = "";
  $input().style.height = "";
  addUser(text);
  turn = el("div", "turn");
  turn.append(el("div", "steps"));
  log.append(turn);
  setBusy(true);
  /** @type {any} */
  let r;
  try {
    r = await window.buddy.taskAsk(text);
  } catch {
    // Buddy's side failed: the task mustn't stay busy with typing locked.
    r = { reply: t("Something went wrong on Buddy's side. Try again.") };
  }
  const { reply, title } = r;
  setBusy(false);
  $("confirm").classList.remove("on");
  if (title) $("title").textContent = title;
  turn.classList.add("done");
  const answer = turn.querySelector(".buddy");
  if (reply && answer) answer.textContent = reply;
  else if (reply) turn.append(el("div", "buddy", reply));
  turn = null;
  scrollDown();
  $input().focus();
});

// Enter sends, Shift+Enter breaks the line; the field grows with what you type. While the task works, Enter does
// nothing (only the Stop button or Esc stops it), so typing ahead can't cancel it by accident.
$input().addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!busy) $form().requestSubmit();
  }
});
$input().addEventListener("input", (e) => {
  const box = /** @type {HTMLTextAreaElement} */ (e.target);
  box.style.height = "";
  box.style.height = Math.min(140, box.scrollHeight + 2) + "px";
  box.classList.toggle("full", box.scrollHeight + 2 > 140);
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (busy) window.buddy.taskCancel(); else window.buddy.taskMinimize();
});
$("min").addEventListener("click", () => window.buddy.taskMinimize());
$("close").addEventListener("click", () => window.buddy.taskClose());

// The words in this window's language, now and whenever it changes.
whenStrings(() => setBusy(busy));
