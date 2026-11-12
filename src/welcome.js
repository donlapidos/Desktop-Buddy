// First-run setup, in the bubble. Someone without an AI set up sees three ways in, in plain words, never a bare
// "paste a key" field: use the AI app they already have (Buddy adds itself to it, no key needed), a free model on
// this PC (Ollama or LM Studio, found if they're running), or an API key. This module finds what's on the PC and says
// it; main.js does the setting up.
import { listModels, PROVIDERS } from "./providers.js";

/** The local servers Buddy can think with, in the order they're offered. */
export const LOCAL = /** @type {const} */ (["ollama", "lmstudio"]);

// How long a local server gets to answer. One that's running answers at once; one that isn't refuses at once; this
// only bounds a firewall that drops the connection silently.
const PROBE_MS = 2_500;

/**
 * @typedef {{ id: "ollama" | "lmstudio", label: string, site: string, running: boolean, models: string[] }} LocalServer
 */

/**
 * Which local servers are running, and the chat models each has.
 * @param {{ urls?: Partial<Record<"ollama" | "lmstudio", string>>, fetchImpl?: typeof fetch }} [o]
 * @returns {Promise<LocalServer[]>}
 */
export async function findLocal({ urls = {}, fetchImpl = fetch } = {}) {
  return Promise.all(
    LOCAL.map(async (id) => {
      const baseURL = urls[id] ?? PROVIDERS[id].baseURL;
      const base = { id, label: PROVIDERS[id].label, site: PROVIDERS[id].keyFrom };
      try {
        const models = await Promise.race([
          listModels(id, "", { baseURL, fetchImpl }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("no answer")), PROBE_MS)),
        ]);
        return { ...base, running: true, models };
      } catch {
        return { ...base, running: false, models: [] };
      }
    }),
  );
}

// A model that reads the screen and uses tools well enough for Buddy needs about this much free memory.
export const LOCAL_MEMORY_GB = 8;

/** What this PC's memory means for a model on it, in words. @param {number} totalBytes */
export function memoryWords(totalBytes) {
  const gb = Math.round(totalBytes / 2 ** 30);
  if (gb >= 3 * LOCAL_MEMORY_GB) return `This PC has ${gb} GB of memory, which is plenty.`;
  if (gb >= LOCAL_MEMORY_GB + 4) return `This PC has ${gb} GB of memory: enough, with other apps closed.`;
  return `This PC has ${gb} GB of memory, which is likely too little: a model on it would be slow or wouldn't load. An AI app or an API key will work better.`;
}

/**
 * What the "Free, on this PC" choice says and offers, from what's running.
 * @param {LocalServer[]} servers @param {number} totalBytes
 * @returns {{ text: string, use: { id: "ollama" | "lmstudio", label: string, model: string } | null }}
 */
export function localDoor(servers, totalBytes) {
  const ready = servers.find((s) => s.running && s.models.length);
  if (ready) return { text: `${ready.label} is running on this PC with ${ready.models.length === 1 ? "a model" : `${ready.models.length} models`}. Buddy can think with it, free and private: nothing leaves this PC.`, use: { id: ready.id, label: ready.label, model: ready.models[0] } };
  const empty = servers.find((s) => s.running);
  const memory = memoryWords(totalBytes);
  if (empty) return { text: `${empty.label} is running but has no models yet. Download one in ${empty.label} that can use tools (its model list says so), then check again. A model needs about ${LOCAL_MEMORY_GB} GB of free memory. ${memory}`, use: null };
  return {
    text: `Buddy can think with a free model on this PC, through Ollama (${PROVIDERS.ollama.keyFrom}) or LM Studio (${PROVIDERS.lmstudio.keyFrom}). Neither is running now. Install one, download a model that can use tools, start it, then check again. A model needs about ${LOCAL_MEMORY_GB} GB of free memory. ${memory}`,
    use: null,
  };
}

// ---------- The thirty-second tour, right after setup ----------
// Two tips in the bubble. First: ask about the window in front, and Buddy points the way (a real step, in a real app).
// Then, once that's answered: Mark, shown once. Either can be skipped; the step is saved, so it's never shown twice.

/** @typedef {"none" | "ask" | "mark" | "done"} TourStep */
/** @typedef {"setup" | "answered" | "marked" | "skip" | "gotit"} TourEvent */

/**
 * The tour's next step. Only setting Buddy up starts it; nothing brings it back once done.
 * @param {TourStep} step @param {TourEvent} event @returns {TourStep}
 */
export function tourNext(step, event) {
  if (step === "none") return event === "setup" ? "ask" : "none";
  if (step === "done") return "done";
  if (event === "skip") return "done";
  if (step === "ask" && event === "answered") return "mark";
  if (step === "mark" && (event === "marked" || event === "gotit")) return "done";
  return step;
}

/**
 * An app's name as people say it: "Excel" from a window titled "Book1 - Excel", else the program's name.
 * @param {{ app_name?: string, title?: string } | null | undefined} win
 */
export function appWords(win) {
  // Edge puts an invisible space inside its own name ("Microsoft​ Edge").
  const title = String(win?.title ?? "").replace(/[​-‍﻿]/g, "");
  const fromTitle = title.split(/ [-–—] /).at(-1)?.trim();
  if (fromTitle && fromTitle.length <= 40 && fromTitle !== title) return fromTitle;
  // Program names run words together: "WindowsTerminal" is said "Windows Terminal".
  const name = String(win?.app_name ?? "").replace(/\.exe$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return name || null;
}

/**
 * The tip the bubble shows for a step, or null when there's none.
 * @param {TourStep} step @param {{ ask: string, mark: string, app: string | null }} words
 * @returns {{ text: string, action: string, event: "skip" | "gotit" } | null}
 */
export function tourTip(step, { ask, mark, app }) {
  if (step === "ask") {
    const where = app ? `in ${app}` : "in the app you were using";
    return { text: `Try it: ask me how to do something ${where}, like "How do I…?", and I'll point the way. Later, press ${ask} from any app.`, action: "Skip tour", event: "skip" };
  }
  if (step === "mark") return { text: `One more: press ${mark}, then draw around anything on your screen, and I'll explain what you circled.`, action: "Got it", event: "gotit" };
  return null;
}
