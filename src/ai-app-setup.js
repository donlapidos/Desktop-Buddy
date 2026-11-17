// Use with your AI app, the setting-up side: adding Buddy to an AI app (or taking it out), repairing apps that start an
// old Buddy, the quick Claude Code chat, and what the welcome offers. The calls themselves come in through app-bridge.js.
import { app } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPS, APP_IDS, allowRules, appStatus, claudeCodeExe, launchSpec, quickChatArgs, quickChatConfig, setApp, setCodeAllowed, staleApps } from "./ai-apps.js";
import { SAFE_TOOLS } from "./bridge.js";
import { findLocal, localDoor } from "./welcome.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// End-to-end checks point the AI-app choice at a made-up home folder, so the user's own apps are never changed.
const appPlaces = process.env.BUDDY_E2E && process.env.BUDDY_APPS_HOME
  ? { home: process.env.BUDDY_APPS_HOME, appData: path.join(process.env.BUDDY_APPS_HOME, "AppData"), localAppData: path.join(process.env.BUDDY_APPS_HOME, "Local") }
  : undefined;

const appSpec = (/** @type {import("./ai-apps.js").AppId} */ id) => launchSpec(process.execPath, path.join(here, "mcp-server.js"), id);

/**
 * @param {{ trace: (entry: object) => void, documentsDir: () => string }} deps
 */
export function createAiAppSetup({ trace, documentsDir }) {
  /** Adds Buddy to one of the AI apps, or takes it out. Resolves an error message, or null. */
  async function setClaude(/** @type {import("./ai-apps.js").AppId} */ which, /** @type {boolean} */ on, why = "settings") {
    const error = (await setApp(which, on ? appSpec(which) : null, appPlaces)) ?? (which === "code" ? setCodeAllowed(allowRules(SAFE_TOOLS), on) : null);
    // Claude Code also gets allow rules for Buddy's look-and-point tools, so it doesn't stop to check each one.
    trace({ kind: "claude-setup", which, on, why, error });
    return error;
  }

  /**
   * Opens a quick Claude Code chat in a terminal: only Buddy's tools, none of the user's plugins or hooks, so each turn
   * is several times faster. Runs on their Claude plan. Resolves an error message, or null.
   */
  async function openQuickChat() {
    if (appStatus().code === "missing") return "Claude Code isn't on this PC.";
    const mcpFile = path.join(app.getPath("userData"), "quick-chat-mcp.json");
    fs.writeFileSync(mcpFile, quickChatConfig(appSpec("code")));
    fs.mkdirSync(documentsDir(), { recursive: true });
    const exe = claudeCodeExe();
    const args = quickChatArgs(mcpFile, [...SAFE_TOOLS]);
    const start = (/** @type {string} */ command, /** @type {string[]} */ argv) =>
      new Promise((resolve) => {
        const child = spawn(command, argv, { cwd: documentsDir(), detached: true, stdio: "ignore" });
        child.once("error", () => resolve(false));
        child.once("spawn", () => (child.unref(), resolve(true)));
      });
    // Windows Terminal when there is one, else a console window of its own.
    const ok = (await start("wt.exe", ["-d", documentsDir(), "--title", "Buddy · Claude", exe, ...args])) || (await start(exe, args));
    trace({ kind: "quick-chat", ok });
    return ok ? null : "Couldn't start Claude Code.";
  }

  // Apps that start Buddy under an old name, from where Buddy used to be, or without saying which app they are, are
  // pointed at this Buddy.
  async function repairClaude() {
    for (const which of staleApps(appSpec)) await setClaude(which, true, "repair");
  }

  /**
   * What the welcome offers: the AI apps on this PC (and whether Buddy is in each), and what a model on this PC needs.
   * @param {Record<string, string>} providerURLs where the user said Ollama or LM Studio are
   */
  async function welcomeState(providerURLs) {
    const status = appStatus(appPlaces);
    const apps = APP_IDS.filter((id) => status[id] !== "missing").map((id) => ({ id, label: APPS[id].label, added: status[id] === "added" }));
    const local = localDoor(await findLocal({ urls: providerURLs }), os.totalmem());
    return { apps, local };
  }

  return { setClaude, openQuickChat, repairClaude, welcomeState };
}
