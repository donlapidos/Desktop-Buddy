import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createProviderState } from "../src/provider-state.js";
import { normalize } from "../src/settings.js";

// The provider's key and model list (provider-state.js): what Settings shows has to match the key that's saved.

const fakeStorage = { encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().slice(4) };
const GOOD = "good-key-0123456789abcdef";
const STALE = "stale-key-0123456789abcdef";

/** A server that lists models for the good key only. A request with the stale key is held until released: the slow, older refresh. */
async function server() {
  const held = [];
  const s = http.createServer((req, res) => {
    const answer = () => {
      if (req.headers.authorization !== `Bearer ${GOOD}`) return res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Incorrect API key provided." } }));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "model-a", object: "model" }, { id: "model-b", object: "model" }] }));
    };
    if (req.headers.authorization === `Bearer ${STALE}`) held.push(answer);
    else answer();
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", () => r(null)));
  return { url: `http://127.0.0.1:${/** @type {any} */ (s.address()).port}/v1`, server: s, held };
}

function state(t, url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-provider-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let settings = normalize({ provider: "custom", providerURLs: { custom: url } });
  const ps = createProviderState({
    dataDir: () => dir, safeStorage: fakeStorage, settings: () => settings,
    change: (patch) => ((settings = normalize({ ...settings, ...patch, providerModels: { ...settings.providerModels, ...(/** @type {any} */ (patch).providerModels ?? {}) } })), {}),
    restart() {}, refresh() {}, trace() {},
  });
  return ps;
}

test("a mistyped key is turned down without making the working key's provider look broken", async (t) => {
  const { url, server: s } = await server();
  t.after(() => s.close());
  const ps = state(t, url);
  assert.equal(await ps.setApiKey(GOOD), null);
  assert.deepEqual(ps.providerModelLists.get("custom")?.models, ["model-a", "model-b"]);
  const wrong = await ps.setApiKey("wrong-key-0123456789abcdef");
  assert.ok(wrong, "the wrong key is refused");
  assert.equal(ps.loadApiKey("custom"), GOOD, "the saved key stays");
  assert.deepEqual(ps.providerModelLists.get("custom")?.models, ["model-a", "model-b"], "and Settings still lists its models");
  assert.equal(ps.providerModelLists.get("custom")?.error, null);
});

test("when two model-list refreshes overlap, the older one can't replace the newer answer", async (t) => {
  const { url, server: s, held } = await server();
  t.after(() => s.close());
  const ps = state(t, url);
  ps.saveApiKey(GOOD, "custom");
  // The first refresh's answer is slow; a second one, started after, answers first.
  const older = ps.refreshModels("custom", STALE);
  for (let i = 0; i < 50 && !held.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(held.length, 1, "the older refresh is waiting on the server");
  assert.equal(await ps.refreshModels("custom", GOOD), null);
  held.forEach((answer) => answer());
  await older;
  assert.deepEqual(ps.providerModelLists.get("custom")?.models, ["model-a", "model-b"], "the newer list stands");
  assert.equal(ps.providerModelLists.get("custom")?.error, null);
});
