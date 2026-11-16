// Strict replay of recorded app windows. These measure routes and recovery over
// accessibility text; they do not establish mouse, rendering or visual quality.
import fs from "node:fs";
import { inOrder, shown } from "../src/evals.js";

const win = (name) => JSON.parse(fs.readFileSync(new URL(`./windows/${name}.json`, import.meta.url), "utf8")).tree;
const home = win("excel-budget-home");
const data = win("excel-budget-data");
const sort = win("excel-sort-dialog");
const wiki = win("edge-wikipedia-article");
const plainReply = (reply) => reply.normalize("NFKC").replace(/[\u2018\u2019\u02bc]/g, "'");
const noAction = (calls) => calls.some((c) => c.kind === "act" || c.kind === "file") ? "operated when asked only to guide" : null;
const only = (pattern) => (calls) => noAction(calls) ?? (shown(calls).length && shown(calls).every((name) => pattern.test(name)) ? null : `expected only ${pattern}; showed ${shown(calls).join(", ") || "nothing"}`);
const openedSort = (calls) => noAction(calls) ?? inOrder(/^data$/, /^sort\.\.\.$/)(calls) ??
  (calls.filter((c) => c.name === "wait-appeared").length === 2 ? null : "did not observe both recorded results");

/** @type {import("../src/evals.js").EvalCase[]} */
export const WORKFLOW_CASES = [
  {
    id: "workflow-excel-sort-dialog", title: "Excel: reach and verify the Sort dialog", app: "EXCEL.EXE", strict: true,
    window: home, next: [[/^data$/, data], [/^sort\.\.\.$/, sort]],
    ask: "Show me how to open the Sort dialog from here, and check that it opens. Let me do the clicking.",
    check: openedSort,
  },
  {
    id: "workflow-excel-correction", title: "Excel: correct Name Box to Formula Bar", app: "EXCEL.EXE", strict: true, window: home,
    ask: "Point out the Name Box. Don't click it.", check: only(/^name box$/),
    followUps: [{ ask: "Actually, I meant the Formula Bar. Point to that instead.", check: only(/^formula bar$/) }],
  },
  {
    id: "workflow-excel-fresh-refs", title: "Excel: continue after the user changes tabs", app: "EXCEL.EXE", strict: true, window: home,
    ask: "Where is the Data tab? Just point it out.", check: only(/^data$/),
    followUps: [{ window: data, ask: "I've opened Data myself. Now just point to Sort Z to A; don't take me through the previous step again.",
      check: (calls) => calls.some((c) => c.name === "invalid-ref") ? "used a stale or invented ref after the tab changed" : only(/^sort z to a$/)(calls) }],
  },
  {
    id: "workflow-browser-search", title: "Edge: distinguish website search from address bar", app: "msedge.exe", strict: true, window: wiki,
    ask: "Point to this website's Search link, not the browser's address bar. Don't open it yet.", check: only(/^search$/),
  },
  {
    id: "workflow-browser-missing", title: "Edge: recover when a requested button is absent", app: "msedge.exe", strict: true, window: wiki,
    ask: "Can you point to a button named Download report on this page? If you cannot see it, say so and ask me one question to help find it.",
    check: (calls, reply) => noAction(calls) ?? (shown(calls).length ? "pointed to a different or invented control" :
      /\?/.test(reply) && /can't|cannot|couldn't|don't see|not (visible|shown|on)|isn't|missing|unable/i.test(plainReply(reply)) ? null : "did not acknowledge the missing control and ask a recovery question"),
  },
  {
    id: "workflow-excel-unverified", title: "Excel: do not claim an unopened dialog is open", app: "EXCEL.EXE", strict: true,
    window: data, next: [[/^sort\.\.\.$/, data]],
    ask: "Guide me to open the Sort dialog using Sort... and wait for it. If it doesn't open, tell me that rather than saying it is done.",
    check: (calls, reply) => noAction(calls) ?? (!shown(calls).includes("sort...") ? "did not guide to Sort..." :
      !calls.some((c) => c.name === "wait-timeout") ? "did not check the recorded result" :
      /hasn't|haven't|didn't|doesn't|isn't|not open|not opened|not (yet )?(verified|confirmed)|couldn't|can't confirm|timed out|stuck/i.test(plainReply(reply)) ? null : "claimed or implied completion without acknowledging the unverified result"),
  },
];
