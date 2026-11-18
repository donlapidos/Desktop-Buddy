import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORKFLOW_CASES } from "../evals/workflow-cases.mjs";

// Each run loads all of Buddy (about 3 s alone, far more while the rest of the suite runs): the limit only stops a hang.
const run = (...args) => spawnSync(process.execPath, ["scripts/eval.mjs", ...args], { encoding: "utf8", timeout: 30000, windowsHide: true });

test("workflow cases can be listed without a provider or API key", { timeout: 60000 }, () => {
  const result = run("--set", "workflows", "--list");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split(/\r?\n/).length, 6);
  assert.match(result.stdout, /workflow-excel-correction/);
});

test("unknown sets and unknown case IDs fail before any model call", { timeout: 120000 }, () => {
  for (const args of [["--set", "typo"], ["--set", "workflows", "--cases", "typo"], ["--set", "workflows", "--cases", ""]]) {
    const result = run(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Unknown|Usage/);
  }
});

test("rescore CLI preserves the original and needs no model configuration", { timeout: 150000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-rescore-test-"));
  const input = path.join(dir, "input.json");
  const output = path.join(dir, "output.json");
  const c = WORKFLOW_CASES.find((c) => c.id === "workflow-browser-missing");
  const original = JSON.stringify({ passed: 0, total: 1, results: [{ id: c.id, title: c.title, passed: false, problem: "old scoring failure", ms: 3000,
    stages: [{ ask: c.ask, reply: "I can’t see that button. Which report do you mean?", calls: [], problem: "old scoring failure" }] }] });
  fs.writeFileSync(input, original);
  try {
    const same = run("--set", "workflows", "--rescore", input, "--json", input);
    assert.equal(same.status, 2);
    assert.match(same.stderr, /original run is preserved/);
    const result = run("--set", "workflows", "--rescore", input, "--json", output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no model calls made/);
    assert.equal(JSON.parse(fs.readFileSync(output, "utf8")).passed, 1);
    const outputBefore = fs.readFileSync(output, "utf8");
    const overwrite = run("--set", "workflows", "--rescore", input, "--json", output);
    assert.equal(overwrite.status, 2, "an existing output (including an alias of the input) cannot be overwritten");
    assert.equal(fs.readFileSync(output, "utf8"), outputBefore);
    assert.equal(fs.readFileSync(input, "utf8"), original);
  } finally {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.unlinkSync(input);
    fs.rmdirSync(dir);
  }
});
