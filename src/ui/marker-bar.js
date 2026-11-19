// The toolbar over live marking (marker-bar.html): how many things are marked, Undo, Ask and Cancel. The drawing itself
// happens in the native overlay underneath (marker-live.js), which tells Buddy the count. Type-checked with the rest of
// Buddy (tsconfig.json).
const $ = (/** @type {string} */ id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
let count = 0;

function update() {
  $("count").textContent = count ? t("{n} marked · keep going or ask", { n: count }) : t("Click something to explain it, or draw over things to ask");
  $("undo").disabled = !count;
  $("ask").disabled = !count;
}

$("undo").addEventListener("click", () => window.buddy.markBar("undo"));
$("ask").addEventListener("click", () => window.buddy.markBar("ask"));
$("cancel").addEventListener("click", () => window.buddy.markBar("cancel"));
// Clicking a button gives this window the keyboard: the marker's keys work here too.
addEventListener("keydown", (e) => {
  if (e.key === "Enter") window.buddy.markBar("ask");
  else if (e.key === "Escape") window.buddy.markBar("cancel");
  else if ((e.ctrlKey && e.key.toLowerCase() === "z") || e.key === "Backspace") window.buddy.markBar("undo");
});
window.buddy.onMarkBarCount((/** @type {number} */ n) => {
  count = Number(n) || 0;
  update();
});

// The words in this window's language, now and whenever it changes.
whenStrings(update);
