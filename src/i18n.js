// Buddy's words in the user's language. The English text is the key: t("Thinking…") is the Spanish for it when
// Spanish is on, and the English itself when there's no translation yet, so nothing shows blank. Translations are
// src/locales/<code>.json, one { "English": "translation" } table per language; test/strings.test.js fails when a
// marked string has none, or a translation no longer matches anything.
// Pages get the same table from main.js (ui/strings.js). Only the windows' words are translated: what the AI writes
// already comes in the language the user asked in.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The languages Buddy's windows can be shown in, by their own names. */
export const LANGUAGES = Object.freeze({ en: "English", es: "Español" });

/** @type {Record<string, Record<string, string>>} */
const tables = {};
let current = "en";

/** The translations for a language ({} for English, or one that can't be read). */
export function table(code = current) {
  if (code === "en" || !Object.hasOwn(LANGUAGES, code)) return {};
  if (!tables[code]) {
    try {
      tables[code] = JSON.parse(fs.readFileSync(path.join(here, "locales", `${code}.json`), "utf8"));
    } catch {
      tables[code] = {};
    }
  }
  return tables[code];
}

/** Shows Buddy's windows in this language from now on. @param {string} code */
export function setLanguage(code) {
  current = Object.hasOwn(LANGUAGES, code) ? code : "en";
}
export const language = () => current;

/**
 * The words in the current language, with {name} filled in from `vars`.
 * @param {string} text the English @param {Record<string, string | number>} [vars]
 */
export function t(text, vars) {
  const s = (current !== "en" && table()[text]) || text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m)) : s;
}

/** Marks English to be translated where it's shown (with t), not where it's defined. @param {string} text */
export const N = (text) => text;

/**
 * Which language to show: the one chosen in Settings, or (auto) the first of Windows' preferred languages Buddy has.
 * @param {string} setting "auto" or a language code @param {string[]} preferred e.g. ["es-MX", "en-US"]
 */
export function pickLanguage(setting, preferred = []) {
  if (setting !== "auto") return Object.hasOwn(LANGUAGES, setting) ? setting : "en";
  for (const p of preferred) {
    const base = String(p).toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(LANGUAGES, base)) return base;
  }
  return "en";
}
