import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptKeyRecord, keyFor, keyProfileState, keyRecord, originOf } from "../src/keys.js";

test("a key saved for one server goes only to that server", () => {
  const saved = keyRecord(JSON.stringify({ key: "secret-1", origin: "https://llm.example.com" }));
  assert.equal(keyFor(saved, "https://llm.example.com/v1"), "secret-1");
  assert.equal(keyFor(saved, "https://llm.example.com/other/v1"), "secret-1", "any path on the same server");
  assert.equal(keyFor(saved, "https://evil.example.net/v1"), null, "another host gets no key");
  assert.equal(keyFor(saved, "https://llm.example.com:8443/v1"), null, "another port is another server");
  assert.equal(keyFor(saved, "http://llm.example.com/v1"), null, "and so is plain http");
  assert.equal(keyFor(saved, "not a url"), null);
});

test("keys saved before keys knew their address still load, and bare keys of fixed providers stay bare", () => {
  assert.deepEqual(keyRecord("sk-proj-abc"), { key: "sk-proj-abc", origin: null });
  assert.equal(keyFor(keyRecord("sk-proj-abc"), "https://api.openai.com/v1"), "sk-proj-abc");
  assert.deepEqual(keyRecord('{"something":"else"}'), { key: '{"something":"else"}', origin: null }, "only a stored record is read as one");
  assert.equal(originOf("http://localhost:11434/v1"), "http://localhost:11434");
  assert.equal(originOf(null), null);
});

test("the asynchronous decrypt result is unwrapped without rewriting saved ciphertext", async () => {
  const encrypted = Buffer.from("test ciphertext");
  const storage = {
    decryptStringAsync: async (input) => { assert.equal(input, encrypted); return { result: '{"key":"test-secret","origin":"https://llm.example.com"}', shouldReEncrypt: true }; },
    decryptString: () => assert.fail("the legacy path is unnecessary"),
  };
  assert.deepEqual(await decryptKeyRecord(storage, encrypted), { key: "test-secret", origin: "https://llm.example.com" });
  assert.equal(encrypted.toString(), "test ciphertext");
});

test("saved keys remain readable when the async API or its ciphertext support is unavailable", async () => {
  for (const extra of [{}, { decryptStringAsync: async () => { throw new Error("unsupported ciphertext"); } }, { decryptStringAsync: async () => ({}) }]) {
    const storage = { decryptString: () => "test-legacy-key", ...extra };
    assert.equal((await decryptKeyRecord(storage, Buffer.from("test"))).key, "test-legacy-key");
  }
  await assert.rejects(() => decryptKeyRecord({ decryptString: () => { throw new Error("locked"); } }, Buffer.from("test")), /locked/);
  await assert.rejects(() => decryptKeyRecord({ decryptString: () => "" }, Buffer.from("test")), /could not be unlocked/);
});

test("an isolated key profile carries encrypted metadata and excludes unrelated profile data", () => {
  const original = { os_crypt: { encrypted_key: "os-encrypted-value", audit_enabled: true, unexpected_secret: "omit-me" },
    preferences: { account: "omit-me" }, cookies: "omit-me", apiKey: "omit-me" };
  const before = JSON.stringify(original);
  assert.deepEqual(keyProfileState(original), { os_crypt: { encrypted_key: "os-encrypted-value", audit_enabled: true } });
  assert.equal(JSON.stringify(original), before);
  assert.doesNotMatch(JSON.stringify(keyProfileState(original)), /omit-me/);
  assert.equal(keyProfileState({ os_crypt: { encrypted_key: 123 } }), null);
  assert.equal(keyProfileState(null), null);
});
