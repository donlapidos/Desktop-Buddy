// Who Buddy thinks with, as it stands on this PC: each provider's saved key (encrypted at rest with the OS keychain),
// where each provider is, the models it offers for the key, what they can do, and the model check run from Settings.
// main.js wires it to Settings, the bubble and the Brain.
import fs from "node:fs";
import path from "node:path";
import { failureFor } from "./brain.js";
import { CASES, runEvals } from "./evals.js";
import { keyFor, keyRecord, originOf } from "./keys.js";
import { worksWell } from "./model-results.js";
import { PROVIDERS, ProviderError, addressProblem, capsOf, describeModels, keyFits, listModels, noteTested, providerForKey, providerOfKey, testedOf, useCapsStore, verdict } from "./providers.js";
import { ADDRESS_PROVIDERS } from "./settings.js";

/** @typedef {import("./providers.js").ProviderId} ProviderId */

/**
 * @param {{
 *   dataDir: () => string,                                  // Buddy's data folder
 *   safeStorage: { encryptString: (text: string) => Buffer, decryptString: (data: Buffer) => string },
 *   settings: () => import("./settings.js").Settings,
 *   change: (patch: object) => Record<string, string>,      // apply a settings change
 *   restart: () => void,                                    // start a new Brain on the current provider
 *   refresh: () => void,                                    // show a change in an open Settings window
 *   trace: (entry: object) => void,
 * }} deps
 */
export function createProviderState({ dataDir, safeStorage, settings, change, restart, refresh, trace }) {
  // ---------- API keys, one per provider ----------

  // Anthropic's key keeps the file name it had before Buddy knew other providers.
  const keyFile = (/** @type {ProviderId} */ provider = currentProvider()) => path.join(dataDir(), provider === "anthropic" ? "api-key.bin" : `api-key-${provider}.bin`);
  const currentProvider = () => /** @type {ProviderId} */ (settings()?.provider ?? "anthropic");
  const envKey = (/** @type {ProviderId} */ provider = currentProvider()) => process.env[PROVIDERS[provider].keyEnv ?? ""] || null;

  // A key for a server at an address the user chose ("Other server") is kept with that address, and only ever sent
  // there: change the address to another host and the saved key stays home until a key is entered for the new one.
  // (keys.js: keyRecord, keyFor.) Keys of providers at fixed addresses are kept as they are.
  const boundToAddress = (/** @type {ProviderId} */ provider) => ADDRESS_PROVIDERS.includes(provider);

  /** The saved key as stored: the key, and the address it was entered for (null for fixed-address providers). */
  function savedKey(/** @type {ProviderId} */ provider) {
    try {
      return keyRecord(safeStorage.decryptString(fs.readFileSync(keyFile(provider))));
    } catch {
      return null;
    }
  }

  function loadApiKey(/** @type {ProviderId} */ provider = currentProvider()) {
    if (envKey(provider)) return envKey(provider);
    const saved = savedKey(provider);
    if (!saved || !boundToAddress(provider)) return saved?.key ?? null;
    // Saved before keys knew their address: it's tied to where it's used now, once.
    if (!saved.origin) saveApiKey(saved.key, provider);
    return keyFor(saved, providerURL(provider));
  }

  function saveApiKey(/** @type {string} */ key, /** @type {ProviderId} */ provider) {
    fs.mkdirSync(path.dirname(keyFile(provider)), { recursive: true });
    const stored = boundToAddress(provider) ? JSON.stringify({ key, origin: originOf(providerURL(provider)) }) : key;
    fs.writeFileSync(keyFile(provider), safeStorage.encryptString(stored));
  }

  // A key that plainly belongs to another provider (sk-ant-, sk-or-, AIza) is saved for that one, which becomes the
  // provider Buddy uses. Other providers' keys are tried on their model list before they're kept. Resolves an error
  // message, or null.
  async function setApiKey(/** @type {string} */ key) {
    const k = key.trim();
    if (PROVIDERS[currentProvider()].key === "none") return `${PROVIDERS[currentProvider()].label} doesn't use a key.`;
    const provider = providerForKey(k, currentProvider());
    if (!keyFits(provider, k)) {
      // A key that matches no provider's shape isn't "not OpenAI's": nobody chose OpenAI, it's only the fallback.
      if (!providerOfKey(k)) return "That doesn't look like an API key. Anthropic keys start sk‑ant‑, OpenAI sk‑, OpenRouter sk‑or‑, Gemini AIza.";
      return `That doesn't look like a key from ${PROVIDERS[provider].label}. Get one at ${PROVIDERS[provider].keyFrom}.`;
    }
    if (provider !== "anthropic") {
      // Only tried: a key that doesn't work leaves the provider's list as it was (its saved key may well work).
      const before = providerModelLists.get(provider);
      const error = await refreshModels(provider, k);
      if (error && !providerModelLists.get(provider)?.models.length) {
        if (before) providerModelLists.set(provider, before);
        else providerModelLists.delete(provider);
        refresh();
        return error;
      }
    }
    saveApiKey(k, provider);
    if (provider !== currentProvider()) change({ provider });
    else restart();
    return null;
  }

  // ---------- Where each provider is ----------

  // Its fixed address, or the one the user gave (Ollama and LM Studio default to their usual one).
  const providerURL = (/** @type {ProviderId} */ provider = currentProvider()) => settings().providerURLs[provider] ?? PROVIDERS[provider].baseURL ?? null;

  // Whether Buddy can think with this provider: it has a key, or needs none and has an address.
  function providerReady(/** @type {ProviderId} */ provider = currentProvider()) {
    if (PROVIDERS[provider].key === "required") return !!loadApiKey(provider);
    return !!providerURL(provider);
  }

  /** Where Ollama, LM Studio or another server is. Models are listed from it right away. Resolves an error, or null. */
  async function setAddress(/** @type {string} */ url) {
    const provider = currentProvider();
    if (!ADDRESS_PROVIDERS.includes(provider)) return `${PROVIDERS[provider].label}'s address is fixed.`;
    const address = url.trim().replace(/\/+$/, "");
    const problem = addressProblem(address);
    if (problem) return problem;
    change({ providerURLs: { [provider]: address } });
    return null;
  }

  // ---------- The models each provider offers ----------

  // The chat models each provider offers for the saved key (providers.js listModels), fetched when a key is saved or
  // the provider changes. Anthropic's are the fixed list in settings.js.
  /** @type {Map<ProviderId, { models: string[], error: string | null, loading: boolean }>} */
  const providerModelLists = new Map();
  /** @type {Map<ProviderId, number>} the latest refresh of each provider's list */
  const refreshing = new Map();

  // What each model of the current provider can do (providers.js verdict), for Settings to show beside it. One that can
  // do everything Buddy needs is "good" (works well) only once it has passed the bar in a measured run (model-results.js);
  // until then it is "capable".
  function modelListState() {
    const provider = currentProvider();
    const list = providerModelLists.get(provider) ?? { models: [], error: null, loading: false };
    const chosen = settings().providerModels[provider];
    const shown = list.models.length ? list.models : chosen ? [chosen] : [];
    const at = providerURL(provider) ?? undefined;
    const shownVerdict = (m) => {
      const v = verdict(capsOf(provider, at, m));
      return v === "good" && !worksWell(provider, m, testedOf(at, m)) ? "capable" : v;
    };
    return { ...list, verdicts: Object.fromEntries(shown.map((m) => [m, shownVerdict(m)])), tested: Object.fromEntries(shown.map((m) => [m, testedOf(at, m)])) };
  }

  /** Fetches the provider's models; picks the best one if none is chosen yet. Resolves an error message, or null. */
  async function refreshModels(/** @type {ProviderId} */ provider = currentProvider(), key = loadApiKey(provider) ?? "") {
    const baseURL = providerURL(provider);
    if (provider === "anthropic" || !baseURL || (PROVIDERS[provider].key === "required" && !key)) return null;
    // Only the latest refresh for a provider writes its list: an older, slower one (a key pasted, then the address
    // changed) mustn't replace the newer answer.
    const mine = (refreshing.get(provider) ?? 0) + 1;
    refreshing.set(provider, mine);
    providerModelLists.set(provider, { models: providerModelLists.get(provider)?.models ?? [], error: null, loading: true });
    refresh();
    let error = null;
    let models = [];
    try {
      models = await listModels(provider, key, { baseURL });
      await describeModels(provider, key, models, { baseURL });
      if (!models.length) error = PROVIDERS[provider].local ? `${PROVIDERS[provider].label} has no models yet. Download one in ${PROVIDERS[provider].label}, then come back.` : `${PROVIDERS[provider].label} didn't list any chat models for this key.`;
    } catch (err) {
      error = err instanceof ProviderError ? (failureFor(err.kind, provider) ?? err.message) : `Couldn't reach ${PROVIDERS[provider].label}: ${err?.message ?? err}`;
    }
    if (refreshing.get(provider) !== mine) return error;
    providerModelLists.set(provider, { models, error, loading: false });
    const chosen = settings().providerModels[provider];
    // The default is the best-placed model known to work well, else the first that isn't known to lack tools.
    const fit = (want) => models.find((m) => want.includes(verdict(capsOf(provider, baseURL, m))));
    const pick = fit(["good"]) ?? fit(["unknown", "no_images"]) ?? models[0];
    if (models.length && (!chosen || !models.includes(chosen))) change({ providerModels: { [provider]: pick } });
    else refresh();
    return error;
  }

  // What Buddy has learned about models' abilities, kept between runs.
  const capsFile = () => path.join(dataDir(), "model-caps.json");
  function loadModelCaps() {
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(capsFile(), "utf8"));
    } catch {}
    useCapsStore(saved, (entries) => {
      try {
        // Through a temporary file, so a crash mid-write can't leave half a file.
        const tmp = `${capsFile()}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(entries, null, 1));
        fs.renameSync(tmp, capsFile());
      } catch (err) {
        trace({ kind: "model-caps-save-failed", message: String(err) });
      }
      refresh();
    });
  }

  // ---------- Model check (evals.js), run from Settings on the chosen model with the saved key ----------

  /** @type {{ provider: ProviderId, model: string, running: boolean, stopped?: boolean, done: number, total: number, passed: number, missed: string[], abort: AbortController } | null} */
  let modelCheck = null;
  const chosenModel = () => (currentProvider() === "anthropic" ? settings().model : settings().providerModels[currentProvider()]);

  /** Starts a check of the chosen model, or stops the one running. Resolves an error message, or null. */
  function checkModel() {
    if (modelCheck?.running) {
      modelCheck.abort.abort();
      return null;
    }
    const provider = currentProvider();
    const model = chosenModel();
    if (!providerReady() || !model) return "Choose a provider and a model first.";
    const baseURL = providerURL(provider) ?? undefined;
    const check = { provider, model, running: true, done: 0, total: CASES.length, passed: 0, missed: /** @type {string[]} */ ([]), abort: new AbortController() };
    modelCheck = check;
    runEvals({
      provider,
      apiKey: loadApiKey() ?? "",
      baseURL,
      signal: check.abort.signal,
      onCase: (r) => {
        trace({ kind: "model-check-case", model, id: r.id, passed: r.passed, problem: r.problem, ms: r.ms, turns: r.turns, shown: r.calls.map((c) => `${c.kind}:${c.name}`).slice(0, 12), reply: r.reply.slice(0, 300) });
        check.done++;
        if (r.passed) check.passed++;
        else check.missed.push(r.title);
        refresh();
      },
    })
      .then((run) => {
        trace({ kind: "model-check", provider, model, passed: run.passed, total: run.total, avgMs: run.avgMs, stopped: check.abort.signal.aborted });
        if (!check.abort.signal.aborted && run.total === CASES.length) noteTested(baseURL, model, { passed: run.passed, total: run.total, avgMs: run.avgMs, at: new Date().toISOString() });
      })
      .catch((err) => trace({ kind: "model-check", provider, model, error: String(err) }))
      .finally(() => {
        check.running = false;
        check.stopped = check.abort.signal.aborted;
        refresh();
      });
    refresh();
    return null;
  }

  return {
    keyFile, currentProvider, envKey, boundToAddress, savedKey, loadApiKey, saveApiKey, setApiKey,
    providerURL, providerReady, setAddress,
    providerModelLists, modelListState, refreshModels, loadModelCaps,
    chosenModel, checkModel, modelCheck: () => modelCheck,
  };
}
