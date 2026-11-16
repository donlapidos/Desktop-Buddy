import assert from "node:assert/strict";
import { test } from "node:test";
import { LINK_MAX, REPORT_LINES, buildReport, issueLink, redact, reportSettings } from "../src/problem-report.js";

const home = "C:\\Users\\Jane.Doe";
const who = { home, names: ["Jane", "Doe"], pc: "JANES-LAPTOP" };

test("keys and key-shaped text are left out", () => {
  for (const key of ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", "sk-proj-AbCdEf0123456789", "AIzaSyD-0123456789abcdefghijklmnopq", "ghp_0123456789abcdefghijklmnopqrstuv",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U", "Q2xhdWRlIGlzIGEgZ29vZCBib3QgYW5kIHRoaXMgaXMgYSBzZWNyZXQ="]) {
    const out = redact(`{"kind":"model-check","error":"401 for key ${key} rejected"}`, who);
    assert.doesNotMatch(out, new RegExp(key.slice(4, 14).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), key);
    assert.match(out, /<key>/);
  }
});

test("paths in the user's folder are left out whole, however they're written", () => {
  for (const path of ["C:\\Users\\Jane.Doe\\Documents\\Payroll\\salaries-2026.xlsx", "C:\\\\Users\\\\Jane.Doe\\\\AppData\\\\Roaming\\\\desktop-buddy\\\\timing.log",
    "c:/users/jane.doe/Desktop/divorce letter.docx"]) {
    const out = redact(`{"kind":"document","file":"${path}"}`, who);
    assert.doesNotMatch(out, /Jane|Doe|salaries|AppData|divorce|letter/i, out);
  }
  assert.match(redact("ran in C:\\Program Files\\Desktop Buddy", who), /Program Files/, "paths outside their folder stay");
});

test("email addresses, the PC's name and the user's names are left out; timings stay", () => {
  const out = redact('{"t":"2026-11-16T10:00:00Z","kind":"model","ms":2513,"note":"jane.doe@example.com on JANES-LAPTOP, Jane asked"}', who);
  assert.doesNotMatch(out, /jane|JANES-LAPTOP/i);
  assert.match(out, /"ms":2513/);
  assert.match(out, /2026-11-16T10:00:00Z/);
});

test("settings go in without addresses, routines or app lists", () => {
  const s = reportSettings({ provider: "custom", model: "m", providerURLs: { custom: "http://10.0.0.5:8080/v1" }, routines: [{ prompt: "Email my boss that I quit" }], trustedApps: ["SecretApp"], blockedApps: [], holdToTalk: true });
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /10\.0\.0\.5|quit|SecretApp/);
  assert.equal(s.holdToTalk, true);
  assert.equal(s.provider, "custom");
});

test("the report shows the last entries, redacted, and is what would be sent", () => {
  const timing = Array.from({ length: REPORT_LINES + 20 }, (_, i) => `{"kind":"tool","ms":${i},"file":"${home.replaceAll("\\", "\\\\")}\\\\Documents\\\\x${i}.txt","key":"sk-ant-api03-${"z".repeat(40)}"}`);
  const { body } = buildReport({ version: "0.4.0", windows: "10.0.26300", electron: "45.2.3", agentDesktop: "1.2.0", settings: { provider: "anthropic", providerURLs: {} }, timing, ...who });
  assert.match(body, /Desktop Buddy 0\.4\.0/);
  assert.equal((body.match(/"kind":"tool"/g) ?? []).length, REPORT_LINES);
  assert.doesNotMatch(body, /sk-ant|Jane|Doe/);
  assert.match(body, /"ms":79/);
});

test("a report too long for a link is copied, and the link says to paste it", () => {
  const long = { title: "Problem: ", body: `**What happened?**\n\n---\n${"x".repeat(LINK_MAX)}` };
  const link = issueLink("https://github.com/o/r/issues/new", long);
  assert.equal(link.copy, true);
  assert.ok(link.url.length < LINK_MAX);
  assert.match(decodeURIComponent(link.url.replaceAll("+", " ")), /paste it here/);
  assert.equal(issueLink("https://github.com/o/r/issues/new", { title: "t", body: "short" }).copy, false);
});
