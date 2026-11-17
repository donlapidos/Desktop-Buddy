// Where people tell the owner things: a problem report (problem-report.js), a feature request, and interest in Buddy
// Plus, each opened in the browser on the repository for the user to read and send themselves.
import { app, clipboard, shell } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, issueLink } from "./problem-report.js";
import { namesToHide } from "./scrub.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const RELEASES = "https://github.com/donlapidos/desktop-buddy/releases";
const ISSUES = "https://github.com/donlapidos/desktop-buddy/issues/new";
// Where people say they'd want Buddy Plus (the AI included, no key). One place, so a form without a GitHub account
// can replace it.
export const PLUS_INTEREST = `${ISSUES}?template=buddy-plus.yml`;

const AGENT_DESKTOP = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, "../package.json"), "utf8")).agentDesktop?.version ?? "?";
  } catch {
    return "?";
  }
})();

/**
 * "Report a problem": built for the user to read in Settings, and sent only when they press a button there, exactly
 * as they saw it.
 * @param {{ timingLog: string, settings: import("./settings.js").Settings }} from
 */
export function problemReport({ timingLog, settings }) {
  let timing = [];
  try {
    const text = fs.readFileSync(timingLog, "utf8");
    timing = text.slice(-200_000).split(/\r?\n/);
  } catch {}
  const user = os.userInfo().username;
  return buildReport({ version: app.getVersion(), windows: os.release(), electron: process.versions.electron, agentDesktop: AGENT_DESKTOP,
    settings, timing, home: os.homedir(), names: namesToHide([user]), pc: os.hostname() });
}

/** Sends the report the user read: opens a pre-filled issue (copying it too, if it's too long for a link), or copies it. */
export async function sendProblemReport(/** @type {string} */ how, /** @type {string} */ body) {
  const report = { title: "Problem: ", body: String(body).slice(0, 200_000) };
  if (how === "copy") {
    await clipboard.writeText(report.body);
    return { copied: true, opened: false };
  }
  const link = issueLink(ISSUES, report);
  if (link.copy) await clipboard.writeText(report.body);
  await shell.openExternal(link.url);
  return { copied: link.copy, opened: true };
}

/** A pre-filled feature request, opened in the browser for the user to edit and send. */
export function requestFeature() {
  const body = [
    "**What would you like Buddy to do?**",
    "",
    "",
    "**How would it help you?**",
    "",
    "",
    "---",
    `Desktop Buddy ${app.getVersion()} · Windows ${os.release()}`,
  ].join("\n");
  shell.openExternal(`${ISSUES}?${new URLSearchParams({ title: "Feature request: ", body, labels: "enhancement" })}`);
}
