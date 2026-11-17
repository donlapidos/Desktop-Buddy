// The bubble (bubble.html): the question box, Buddy's answer as it streams, the approval card, first-run setup and the
// tour. A classic script, not a module, so the dev checks can call its functions by name. Type-checked with the rest
// of Buddy (tsconfig.json).
const $ = (id) => document.getElementById(id);
/** The question box, and the form that sends it. */
const $input = () => /** @type {HTMLInputElement} */ ($("input"));
const $form = () => /** @type {HTMLFormElement} */ ($("form"));
let needsKey = false, busy = false;
let askSequence = 0;

function setBusy(on) {
  busy = on;
  $("dot").classList.toggle("busy", on);
  $("reply").setAttribute("aria-busy", String(on));
  $("stop").hidden = !on;
  $input().disabled = false;
  $("submit").textContent = on ? "Send" : "Ask";
  /** @type {HTMLButtonElement} */ ($("new")).disabled = on;
  $input().placeholder = on ? "Change direction or ask a follow-up…" : "How do I…?  or  Do it for me";
}

function show(text, status = false) {
  $("reply").textContent = text;
  $("reply").classList.toggle("status", status);
}

// The tour's tip, or none (null).
let tip = null;
let voiceOffer = null; // the voice download's offer (showVoiceOffer)
function showTip(t) {
  tip = t;
  // One at a time: the bubble has room for one, and the voice offer comes first.
  $("tip").hidden = !t || needsKey || !!voiceOffer;
  if (!t) return;
  $("tip-text").textContent = t.text;
  $("tip-do").textContent = t.action;
}
$("tip-do").addEventListener("click", () => tip && window.buddy.tour(tip.event));
window.buddy.onTour((t) => showTip(t));

// The one-time voice download, offered after setup: an offer, its progress, then how it went (or nothing).
function showVoiceOffer(o) {
  voiceOffer = o;
  $("voice-offer").hidden = !o || needsKey;
  showTip(tip);
  if (!o) return;
  $("voice-offer-text").textContent = o.text;
  $("voice-yes").hidden = $("voice-no").hidden = o.state !== "offer";
}
$("voice-yes").addEventListener("click", () => window.buddy.voiceOffer("yes"));
$("voice-no").addEventListener("click", () => window.buddy.voiceOffer("no"));
window.buddy.onVoiceOffer((o) => showVoiceOffer(o));

// Without the advanced features there are no task windows to move a conversation into.
window.buddy.onAdvanced((on) => document.body.classList.toggle("basic", !on));
window.buddy.onSummon(({ target, needsKey: nk, tip: t, voiceOffer, advanced = true }) => {
  document.body.classList.toggle("basic", !advanced);
  needsKey = nk;
  showTip(t);
  showVoiceOffer(voiceOffer);
  $("marks").classList.remove("on");
  $("where").textContent = nk ? "Welcome to Buddy" : target ? `Looking at ${target}` : "Buddy";
  if (nk) welcome("doors");
  else leaveWelcome();
  if (!busy) { $input().disabled = false; $input().value = ""; if (!nk) $input().focus(); }
});

// ---------- First-run setup: three ways in, never a bare "paste a key" ----------
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const button = (cls, text, onClick) => { const b = el("button", { className: cls, type: "button", textContent: text }); b.addEventListener("click", onClick); return b; };
const back = () => button("btn ghost", "Back", () => welcome("doors"));
let welcomeData = null;

function leaveWelcome() {
  document.body.classList.remove("welcoming");
  $("submit").textContent = "Ask";
  $("welcome").hidden = true;
  $("reply").hidden = false;
  $form().hidden = false;
  $input().type = "text";
  $input().placeholder = "How do I…?  or  Do it for me";
  showTip(tip); // a tour tip that came while setting up
  showVoiceOffer(voiceOffer); // and the voice offer
}

// page: "doors" (the three choices), "apps", "local" or "key".
async function welcome(page) {
  const box = $("welcome");
  document.body.classList.add("welcoming");
  $("submit").textContent = "Save";
  box.hidden = false;
  $("reply").hidden = true;
  $form().hidden = page !== "key";
  console.log("WELCOME_PAGE " + page);
  if (page === "key") {
    $input().type = "password";
    $input().placeholder = "Paste an API key";
    box.replaceChildren(
      el("p", { textContent: "Paste a key from Anthropic, OpenAI, Google Gemini or OpenRouter. It's kept encrypted on this PC." }),
      el("p", { className: "problem" }),
      el("div", { className: "row" }, back(), button("btn ghost", "DeepSeek or another server…", () => window.buddy.openSettings("claude"))),
      button("link", "No key? Would you want Buddy Plus, with the AI included?", () => window.buddy.plusInterest()),
    );
    $input().focus();
    return;
  }
  if (page === "doors" || !welcomeData) {
    box.replaceChildren(el("p", { className: "lede", textContent: "Looking for what's on this PC…" }));
    welcomeData = await window.buddy.welcomeState();
  }
  const { apps, local } = welcomeData;
  if (page === "doors") {
    const found = apps.map((a) => a.label);
    const inApp = apps.some((a) => a.added);
    const door = (title, sub, go, ready = false) => { const b = el("button", { className: `door${ready ? " ready" : ""}`, type: "button" }, el("b", { textContent: title }), el("span", { textContent: sub })); b.addEventListener("click", go); b.dataset.door = go.name; return b; };
    box.replaceChildren(
      el("p", { className: "lede", textContent: "Buddy needs an AI to think with. Pick one way in:" }),
      door("Use the AI app I already have", found.length ? `${found.slice(0, 3).join(", ")}${found.length > 3 ? "…" : ""} on this PC. No key needed.` : "Claude, Codex, Gemini CLI, Cursor and others. No key needed.", function apps() { welcome("apps"); }, inApp),
      door("Free, on this PC", local.use ? `${local.use.label} is running. Private: nothing leaves this PC.` : "With Ollama or LM Studio. Private: nothing leaves this PC.", function local() { welcome("local"); }),
      door("I have an API key", "Anthropic, OpenAI, Google Gemini, OpenRouter…", function key() { welcome("key"); }),
    );
    return;
  }
  if (page === "apps") {
    const problem = el("p", { className: "problem" });
    const rows = apps.map((a) => {
      const row = el("div", { className: "app" }, el("span", { textContent: a.label }));
      if (a.added) row.append(el("span", { className: "added", textContent: "Buddy is in it" }));
      else row.append(button("btn", "Add Buddy", async (e) => {
        e.target.disabled = true;
        e.target.textContent = "Adding…";
        const res = await window.buddy.welcomeApp(a.id);
        console.log("WELCOME_APP " + JSON.stringify({ id: a.id, error: res.error }));
        if (res.error) { problem.textContent = res.error; e.target.disabled = false; e.target.textContent = "Add Buddy"; return; }
        welcomeData = res.state;
        box.replaceChildren(
          el("p", { textContent: `Buddy is in ${a.label}. ${res.after}` }),
          el("p", { className: "lede", textContent: `Then ask there, for example: "Use Buddy to show me how to make a chart here." Buddy looks at your screen and points the way. The bubble here can also think on its own, with one of the other two ways.` }),
          el("div", { className: "row" }, back()),
        );
      }));
      return row;
    });
    box.replaceChildren(
      el("p", { textContent: apps.length ? "You'll ask in your AI app, and Buddy looks and points for it. It runs on that app's own plan." : "No AI app Buddy works with was found on this PC. Buddy works with Claude (the app or Claude Code), Codex, Gemini CLI, Cursor, VS Code, Windsurf and LM Studio. Install one, or pick another way." }),
      ...rows,
      problem,
      el("div", { className: "row" }, back()),
    );
    return;
  }
  if (page === "local") {
    const problem = el("p", { className: "problem" });
    const go = local.use
      ? button("btn", `Use ${local.use.label}`, async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Setting up…";
          const res = await window.buddy.welcomeLocal();
          console.log("WELCOME_LOCAL " + JSON.stringify(res));
          if (!res.ok) { problem.textContent = res.error ?? "That didn't work."; e.target.disabled = false; e.target.textContent = `Use ${local.use.label}`; return; }
          needsKey = false;
          leaveWelcome();
          $("where").textContent = "Buddy";
          show(`Ready. I'm thinking with ${res.label} on this PC. Ask me anything about what's on your screen.`);
          $input().focus();
        })
      : button("btn", "Check again", async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Checking…";
          welcomeData = await window.buddy.welcomeState();
          welcome("local");
        });
    box.replaceChildren(el("p", { textContent: local.text }), problem, el("div", { className: "row" }, back(), go));
  }
}

// Wait a frame so the window has painted the folded pill before it unfolds.
window.buddy.onBubbleOpen(() => requestAnimationFrame(() => requestAnimationFrame(() => {
  document.body.classList.add("open");
  if (!$input().disabled) $input().focus();
})));
window.buddy.onBubbleClose(() => document.body.classList.remove("open"));

window.buddy.onStatus((text) => show(text, true));
window.buddy.onReplyStream((text) => { if (busy) show(text); });

// What the user highlighted: numbered chips matching the marker numbers on screen.
window.buddy.onMarks((list) => {
  const box = $("marks");
  box.replaceChildren();
  for (const m of list) {
    const chip = document.createElement("span");
    chip.className = "chip";
    const n = document.createElement("b");
    n.textContent = m.n;
    const label = document.createElement("span");
    label.textContent = m.label;
    chip.append(n, label);
    box.append(chip);
  }
  const explain = document.createElement("button");
  explain.className = "btn ghost";
  explain.type = "button";
  explain.textContent = list.length > 1 ? "Explain these" : "Explain this";
  explain.addEventListener("click", () => { $input().value = "Explain what I highlighted."; $form().requestSubmit(); });
  box.append(explain);
  box.classList.add("on");
  $("where").textContent = `${list.length} marked`;
  $input().placeholder = list.length > 1 ? "Ask about these marks… (e.g. compare 1 and 2)" : "Ask about what you marked…";
  show("");
});
window.buddy.onReply((text) => { show(text); $("where").textContent = "Buddy"; });

// An approval takes a deliberate click: nothing on the card takes focus (a key meant for another app or the field
// must never land on Allow), and clicks in its first moments are ignored (a click already on its way doesn't count).
const ARM_MS = 500;
let confirmAt = 0;
window.buddy.onConfirm(({ summary, note }) => {
  $("what").textContent = summary;
  $("why").textContent = note && note.toLowerCase() !== summary.toLowerCase() ? note : "";
  $("confirm").classList.add("on");
  confirmAt = performance.now();
  $("confirm").focus();
});

// Nothing waits any more (answered elsewhere, or the asker stopped): the card comes down.
window.buddy.onConfirmClear(() => $("confirm").classList.remove("on"));

$("confirm").addEventListener("pointerdown", (e) => console.log("TRACE press on approval: " + (/** @type {HTMLElement} */ (e.target).dataset?.d || /** @type {HTMLElement} */ (e.target).tagName) + " open=" + document.body.classList.contains("open")));
$("confirm").addEventListener("click", (e) => {
  const d = /** @type {HTMLElement} */ (e.target).dataset?.d;
  if (!d || performance.now() - confirmAt < ARM_MS) return;
  $("confirm").classList.remove("on");
  window.buddy.confirmReply(d);
});

// Voice: the main process listens and transcribes; the words land in the field and go like a typed question.
let listening = false, spoken = false;
window.buddy.onListening((on) => {
  listening = on;
  document.body.classList.toggle("listening", on);
  if (on) show("Listening… pause when you're done.", true);
  else if ($("reply").textContent.startsWith("Listening")) show("");
});
window.buddy.onVoiceText((text) => {
  if (busy || needsKey) return;
  $input().value = text;
  spoken = true;
  $form().requestSubmit();
});
$("mic").addEventListener("click", () => window.buddy.talk());

$form().addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $input().value.trim();
  const wasSpoken = spoken;
  spoken = false;
  if (!text) return;
  $input().value = "";
  if (needsKey) {
    const { ok, error } = await window.buddy.setKey(text);
    console.log("WELCOME_KEY " + JSON.stringify({ ok, error }));
    if (!ok) {
      $("welcome").querySelector(".problem").textContent = error ?? "That didn't work. Try again.";
      return;
    }
    needsKey = false;
    leaveWelcome();
    $("where").textContent = "Buddy";
    show("Got it. Ask me anything about what's on your screen.");
    return;
  }
  setBusy(true);
  const sequence = ++askSequence;
  $("spend").textContent = "";
  show(wasSpoken ? `“${text}”` : "Thinking…", true);
  offerLesson(false);
  const { reply, spend, superseded, lesson } = await window.buddy.ask(text, { spoken: wasSpoken });
  if (sequence !== askSequence) return;
  setBusy(false);
  if (!superseded) show(reply);
  else if (!listening) show("Okay, stopped.");
  $("spend").textContent = spend ?? "";
  offerLesson(!superseded && !!lesson);
  $("confirm").classList.remove("on");
});

$("stop").addEventListener("click", () => window.buddy.cancel());
$("totask").addEventListener("click", () => window.buddy.newTask());
$("settings").addEventListener("click", () => window.buddy.openSettings());
$("new").addEventListener("click", () => { window.buddy.reset(); show(""); $("spend").textContent = ""; offerLesson(false); $input().focus(); });

/** Shows (or hides) "Save as a lesson" under an answer that walked them through a whole route. */
function offerLesson(on) {
  $("lesson").hidden = !on;
  $("lesson-save").hidden = false;
  $("lesson-said").textContent = "";
}
$("lesson-save").addEventListener("click", async () => {
  const r = await window.buddy.saveLesson();
  $("lesson-said").textContent = r?.title ? "Saved. Play it again from the tray, or share it from Settings › Lessons." : r?.error ?? "Couldn't save that.";
  if (r?.title) $("lesson-save").hidden = true;
});
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (busy || listening) window.buddy.cancel(); else window.buddy.hide();
});
