import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// What Buddy's own windows promise someone using a keyboard, a screen reader, Windows high contrast or reduced motion,
// read from the pages themselves.
const ui = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");
const page = (name) => fs.readFileSync(path.join(ui, `${name}.html`), "utf8");
const WINDOWS = ["bubble", "task", "island", "settings", "marker", "overlay"];

/** Each <button>…</button> and its attributes and text, as written in the page. */
const buttons = (html) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, inner]) => ({ attrs, text: inner.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "").trim() }));

test("every button in Buddy's windows has a name a screen reader can say", () => {
  for (const name of WINDOWS) {
    for (const b of buttons(page(name))) {
      // Filled in by the page's script (an empty tip button gets its words when the tip shows).
      if (!b.text && /id="tip-do"/.test(b.attrs)) continue;
      assert.ok(b.text || /aria-label="[^"]+"/.test(b.attrs), `${name}: a button with no words or aria-label: <button${b.attrs}>`);
    }
  }
});

test("every place to type has a label, not only a placeholder", () => {
  for (const name of ["bubble", "task"]) {
    for (const [field] of page(name).matchAll(/<(input|textarea)\b[^>]*>/g)) assert.match(field, /aria-label="[^"]+"/, `${name}: ${field}`);
  }
});

test("an approval card is a dialog with its question as its name, and answers are announced", () => {
  for (const name of ["bubble", "task"]) {
    const html = page(name);
    const card = html.match(/<div id="confirm"[^>]*>/)?.[0] ?? "";
    assert.match(card, /role="alertdialog"/, `${name}: the card's role`);
    assert.match(card, /aria-labelledby="confirm-title"/, `${name}: the card's name`);
    assert.match(card, /tabindex="-1"/, `${name}: the card can take focus`);
    assert.match(html, /id="confirm-title"/, `${name}: the question the card is named by`);
    assert.match(html, /<div id="(reply|log)" role="log" aria-live="polite"/, `${name}: answers are announced`);
    // Focus goes to the card itself, never straight to Allow: a keypress meant for something else can't approve.
    const script = fs.readFileSync(path.join(ui, `${name}.js`), "utf8");
    assert.match(script, /\$\("confirm"\)\.focus\(\)/, `${name}: the card takes focus when it appears`);
    assert.doesNotMatch(script, /data-d="allow"[^\n]*\.focus\(\)|\[data-d="allow"\]"\)\.focus\(\)/, `${name}: Allow is never focused for the user`);
  }
});

test("every window follows Windows high contrast and reduced motion", () => {
  for (const name of WINDOWS) {
    const html = page(name);
    assert.match(html, /@media \(forced-colors: active\)/, `${name}: high contrast`);
    if (/animation|transition/.test(html)) assert.match(html, /@media \(prefers-reduced-motion: reduce\)|@media \(prefers-reduced-motion: no-preference\)/, `${name}: reduced motion`);
  }
});

test("buttons show where the keyboard is", () => {
  for (const name of ["bubble", "task", "settings", "marker"]) assert.match(page(name), /:focus-visible/, name);
});
