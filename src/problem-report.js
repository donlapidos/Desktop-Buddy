// "Report a problem": with no telemetry, this is the only way to learn what went wrong for someone else. Buddy gathers
// its version, the settings (without keys, addresses or anything the user wrote) and the end of its timing log, takes
// out what could be a key or name the user's own files, shows the user every word, and sends nothing unless they press
// a button: then it opens a pre-filled GitHub issue in their browser, or copies the report for them to paste.
import { scrubText } from "./scrub.js";

/** How many of the timing log's last entries go in. */
export const REPORT_LINES = 60;
/** A GitHub issue link longer than this may be cut off; past it the report is copied instead (issueLink). */
export const LINK_MAX = 7_000;

// Key-shaped text: provider keys and tokens by their prefixes, and any long unbroken run of key characters.
const KEYISH = /\b(?:sk-[\w-]{8,}|AIza[\w-]{20,}|gh[pousr]_\w{20,}|xox[abprs]-[\w-]{10,}|eyJ[\w-]{10,}\.[\w-]+\.[\w-]+|[A-Za-z0-9_+/=-]{32,})/g;
// A path in someone's own folder, whole (the file's name can say as much as the folder's), slashes either way and as
// written in JSON (doubled backslashes), up to the end of its string: a name can have spaces in it.
const PROFILE_PATH = /[A-Za-z]:(?:\\{1,2}|\/)(?:Users|Documents and Settings)(?:\\{1,2}|\/)[^"'<>|\r\n]*/gi;

/**
 * Text with keys, paths in the user's folder, and what scrub.js finds (email addresses, numbers, web address paths,
 * the PC's and the user's names) taken out.
 * @param {string} text @param {{ home?: string, names?: string[], pc?: string }} [who]
 */
export function redact(text, { home, names = [], pc } = {}) {
  let s = String(text).replace(KEYISH, "<key>").replace(PROFILE_PATH, "<a path in your folder>");
  if (home && home.length > 3) {
    for (const form of [home, home.replaceAll("\\", "\\\\"), home.replaceAll("\\", "/")]) s = s.split(form).join("<your folder>");
  }
  return scrubText(s, { names, pc });
}

/**
 * The settings, as a report shows them: what helps to reproduce a problem. Left out: addresses (which server, which
 * port), routines (their instructions are the user's own words) and app lists (they name what the user works in).
 * @param {any} settings
 */
export function reportSettings(settings) {
  const { providerURLs, routines, trustedApps, blockedApps, ...rest } = settings ?? {};
  return {
    ...rest,
    providerURLs: Object.keys(providerURLs ?? {}).length ? "(set; left out)" : "(none)",
    routines: Array.isArray(routines) ? `${routines.length} (left out)` : 0,
    trustedApps: Array.isArray(trustedApps) ? `${trustedApps.length} (left out)` : 0,
    blockedApps: Array.isArray(blockedApps) ? `${blockedApps.length} (left out)` : 0,
  };
}

/**
 * The report, as the user will see it and as it would be sent.
 * @param {{ version: string, windows: string, electron: string, agentDesktop: string, settings: any, timing: string[],
 *   home?: string, names?: string[], pc?: string }} o
 * @returns {{ title: string, body: string }}
 */
export function buildReport({ version, windows, electron, agentDesktop, settings, timing, home, names, pc }) {
  const who = { home, names, pc };
  const lines = timing.filter((l) => l.trim()).slice(-REPORT_LINES).map((l) => redact(l, who));
  const body = [
    "**What happened?**",
    "",
    "",
    "**What did you expect?**",
    "",
    "",
    "---",
    `Desktop Buddy ${version} · Windows ${windows} · Electron ${electron} · agent-desktop ${agentDesktop}`,
    "",
    "<details><summary>Settings (no keys, addresses or routines)</summary>",
    "",
    "```json",
    redact(JSON.stringify(reportSettings(settings), null, 1), who),
    "```",
    "</details>",
    "",
    `<details><summary>Timing log, last ${lines.length} entries (timings and outcomes, no window text)</summary>`,
    "",
    "```",
    ...lines,
    "```",
    "</details>",
  ].join("\n");
  return { title: "Problem: ", body };
}

/**
 * The link that opens a pre-filled issue. A report too long for a link opens the issue with a note to paste it, and
 * `copy` says the caller must put the whole report on the clipboard first.
 * @param {string} issuesURL @param {{ title: string, body: string }} report
 */
export function issueLink(issuesURL, report) {
  const full = `${issuesURL}?${new URLSearchParams({ title: report.title, body: report.body, labels: "bug" })}`;
  if (full.length <= LINK_MAX) return { url: full, copy: false };
  const short = report.body.split("\n---\n")[0] + "\n---\n(Buddy copied the full report: paste it here.)";
  return { url: `${issuesURL}?${new URLSearchParams({ title: report.title, body: short, labels: "bug" })}`, copy: true };
}
