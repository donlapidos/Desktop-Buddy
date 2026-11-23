// Where agents may work and how much they may do without asking (Settings › Agents). Every input action an agent
// wants to take is put to decide() before anything else: "block" refuses it outright, "allow" lets approvals.js issue
// its slip without asking, "ask" shows the approval card as before. The user's own dictation doesn't pass through
// here; it isn't an agent acting.

/**
 * @typedef {{ rope: string, trustedApps: string[], blockedApps: string[] }} AgentPolicy
 * @typedef {"click" | "double_click" | "right_click" | "set_value" | "type" | "clear" | "check" | "uncheck" | "toggle"
 *   | "expand" | "collapse" | "select" | "scroll_to" | "press" | "focus" | "restore" | "minimize" | "maximize"
 *   | "launch"} ActionKind
 */

// Moves that only change what's in view: they can't enter, send, delete or change anything.
export const SAFE_KINDS = Object.freeze(new Set(["scroll_to", "expand", "collapse", "focus", "restore", "minimize", "maximize"]));

/** The same app however it's written: "Excel", "EXCEL.EXE", " excel ", a full path to excel.exe. */
export const appKey = (name) => String(name ?? "").trim().split(/[\\/]/).pop().trim().toLowerCase().replace(/\.exe$/, "");

// The model names apps in launch_app and press, so a blocked app mustn't slip through by being spelled another way:
// blocking compares names with spaces and punctuation gone ("Keep-Pass" is "keeppass"), and a blocked name also blocks
// the longer names that start with it ("keepass" blocks "KeePassXC"). When in doubt, block. Trust is never widened
// like that: a trusted app is that app exactly ("notepad" doesn't trust "notepad++").
const compact = (/** @type {string} */ key) => key.replace(/[^\p{L}\p{N}]+/gu, "");
const blockedBy = (list, app) => {
  const a = compact(app);
  return !!a && list.some((x) => {
    const b = compact(appKey(x));
    return !!b && (b.length >= 3 ? a.startsWith(b) : a === b);
  });
};
const trustedIn = (list, app) => !!app && list.some((x) => appKey(x) === app);

/** Whether the Agents rules block `app` outright. @param {AgentPolicy} policy @param {string | null | undefined} app */
export const isBlocked = (policy, app) => blockedBy(policy.blockedApps, appKey(app));

/**
 * @param {AgentPolicy} policy
 * @param {{ kind: string, app?: string | null }} action
 * @returns {"block" | "allow" | "ask"}
 */
export function decide(policy, { kind, app }) {
  const a = appKey(app);
  if (blockedBy(policy.blockedApps, a)) return "block";
  if (policy.rope === "trusted" && trustedIn(policy.trustedApps, a)) return "allow";
  if ((policy.rope === "safe" || policy.rope === "trusted") && SAFE_KINDS.has(kind)) return "allow";
  return "ask";
}
