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
