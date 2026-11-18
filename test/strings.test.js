import assert from "node:assert/strict";
import { test } from "node:test";
import { LANGUAGES, N, pickLanguage, setLanguage, t, table } from "../src/i18n.js";
import { markedStrings } from "./strings-scan.js";

// Every word Buddy marks for translation has one in each language, with the same {placeholders}, and no translation
// is left over for words that are gone. Marked means: t("..."), tr("...") or N("...") with a plain string in the code,
// and data-t (text) or data-t-attrs (attributes) in the pages.
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every marked word has a translation in each language, with the same placeholders, and none is left over", () => {
  const marked = markedStrings();
  assert.ok(marked.size > 100, `only ${marked.size} marked strings found: the scan is broken`);
  for (const code of Object.keys(LANGUAGES).filter((c) => c !== "en")) {
    const tr = table(code);
    const missing = [...marked.keys()].filter((en) => !tr[en]).map((en) => `${marked.get(en)}: ${JSON.stringify(en)}`);
    assert.deepEqual(missing, [], `${code} has no translation for these`);
    const extra = Object.keys(tr).filter((en) => !marked.has(en));
    assert.deepEqual(extra, [], `${code} translates words that are no longer used`);
    for (const [en, out] of Object.entries(tr)) assert.equal(holes(out), holes(en), `${code}: placeholders differ in ${JSON.stringify(en)}`);
  }
});

test("words come out in the chosen language, with their blanks filled, and in English when there's no translation", () => {
  try {
    setLanguage("es");
    assert.notEqual(t("Thinking…"), "Thinking…");
    assert.match(t("Waiting for your OK: {what}", { what: "Click Save" }), /Click Save/);
    assert.equal(t("A sentence nobody marked"), "A sentence nobody marked");
    assert.equal(N("Thinking…"), "Thinking…", "N only marks");
    setLanguage("xx");
    assert.equal(t("Thinking…"), "Thinking…", "an unknown language is English");
  } finally {
    setLanguage("en");
  }
});

test("Buddy follows Windows' language unless one is chosen", () => {
  assert.equal(pickLanguage("auto", ["es-MX", "en-US"]), "es");
  assert.equal(pickLanguage("auto", ["de-DE", "es-ES"]), "es", "the first Buddy has");
  assert.equal(pickLanguage("auto", ["de-DE"]), "en");
  assert.equal(pickLanguage("auto", []), "en");
  assert.equal(pickLanguage("en", ["es-ES"]), "en", "chosen wins");
  assert.equal(pickLanguage("zz", ["es-ES"]), "en");
});
