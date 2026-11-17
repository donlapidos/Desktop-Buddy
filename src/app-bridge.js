// Use with your AI app, the running side: AI apps (Claude Code, Codex, Cursor…) call Buddy's tools over bridge.js's
// pipe. Each of their sessions gets a Brain of its own (app-sessions.js) that only runs tools, points as that session,
// and asks on the same approval card, under the same Agents rules, as Buddy's own conversations.
import { Brain } from "./brain.js";
import { startBridge } from "./bridge.js";
import { createAppSessions } from "./app-sessions.js";
import { listWindows } from "./desktop.js";

/** @typedef {import("./geometry.js").PhysicalRect} PhysicalRect */

// The chat apps the user talks to an AI in; the window they want help with is never one of these.
const CLIENT_APPS = /^(claude|codex|windowsterminal|code|cursor|windsurf|lm studio)\.exe$/i;
// After this long without a call from Claude, "Allow for this task" lapses: the next request is a new task.
const CLAUDE_TASK_GAP_MS = 120_000;
const LOOKS_AT_WINDOW = new Set(["look", "read_page", "screenshot"]);

/**
 * @param {{
 *   dir: string,                                            // Buddy's data folder, where bridge.json goes
 *   ownPids: () => number[],
 *   pendingMarks: () => import("./marker.js").PendingMarks | null,
 *   brainUI: (owner: string, target: () => any) => object,  // what a session's Brain draws, points and asks with (target: the window it looks at)
 *   status: (text: string | null) => void,                  // the island's line for an AI app's call, or null when it's done
 *   notice: (text: string) => void,
 *   trace: (entry: object) => void,
 *   pipe?: string,                                          // a pipe of its own (end-to-end checks); else one per Windows user
 * }} deps
 */
export function createAppBridge({ dir, ownPids, pendingMarks, brainUI, status, notice, trace, pipe }) {
  /** @type {ReturnType<typeof startBridge> | null} */
  let bridge = null;
  // Each AI app session gets a Brain of its own (app-sessions.js).
  /** @type {ReturnType<typeof createAppSessions<Brain>>} */
  const appSessions = createAppSessions({ makeBrain: (conn, client) => makeAppBrain(conn, client), gapMs: CLAUDE_TASK_GAP_MS });
  let lastAppCall = 0;
  let claudeSessions = 0;

  // The window the user works in while they chat with Claude: the frontmost one that isn't Buddy or the chat itself.
  async function userWindow() {
    const own = ownPids();
    return (await listWindows()).find((w) => !own.includes(w.pid) && !CLIENT_APPS.test(w.app_name ?? "")) ?? null;
  }

  function marksForClaude(/** @type {Brain} */ appBrain) {
    const marked = pendingMarks();
    if (!marked) return "The user hasn't marked anything yet. They can press Ctrl+Alt+M and draw over what they mean.";
    appBrain.marks = new Map(marked.marks.map((m) => [m.n, m.bounds]));
    appBrain.target = marked.target ?? appBrain.target;
    const lines = marked.marks.map((m) => {
      const under = m.elements.length
        ? m.elements.map((e) => `${e.path}${e.value ? ` (text: ${JSON.stringify(e.value.slice(0, 200))})` : ""}`).join("; ")
        : "no accessibility info; rely on the image";
      return `Mark ${m.n}: under the stroke: ${under}`;
    });
    return [
      { type: "image", source: { type: "base64", media_type: "image/png", data: marked.image } },
      { type: "text", text: `The image shows the area the user marked, with their translucent blue strokes numbered at their start.\n${lines.join("\n")}` },
    ];
  }

  // A session's Brain: tools only (the app's own model does the thinking), pointing as that session.
  function makeAppBrain(/** @type {number} */ conn, /** @type {string} */ client) {
    const owner = `app-${conn}`;
    /** @type {Brain} */
    const appBrain = new Brain({
      .../** @type {any} */ (brainUI(owner, () => appBrain.target ?? null)),
      status: (text) => status(`${client}: ${text}`),
    });
    return appBrain;
  }

  /** @param {string} name @param {any} input @param {AbortSignal} signal @param {string | undefined} client @param {number} conn */
  async function runForClaude(name, input, signal, client, conn) {
    lastAppCall = Date.now();
    try {
      return await appSessions.call(conn, client ?? "Your AI app", signal, async (appBrain) => {
        if ((LOOKS_AT_WINDOW.has(name) && !input.app && !input.root) || !appBrain.target) appBrain.target = await userWindow();
        return name === "get_marks" ? marksForClaude(appBrain) : appBrain.runTool(name, input);
      });
    } finally {
      lastAppCall = Date.now();
      setTimeout(() => {
        if (Date.now() - lastAppCall > 1000) status(null);
      }, 1500);
    }
  }

  function start() {
    bridge = startBridge({
      dir,
      pipe,
      run: runForClaude,
      onClosed: (conn) => appSessions.close(conn),
      trace,
      onClients: (n) => {
        trace({ kind: "bridge-clients", n });
        // Say so once when a chat starts using Buddy; tool calls then show on the island as "Codex: …" and so on.
        if (n > claudeSessions) notice("Your AI app is using Buddy");
        claudeSessions = n;
      },
    });
  }

  return { start, close: () => bridge?.close() };
}
