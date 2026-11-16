// Saved API keys, as stored (encrypted, by main.js). A key for a server at an address the user chose is stored with
// that address and only ever sent there; keys of providers at fixed addresses are stored bare, as they always were.

/** A web address's origin (scheme, host and port), or null. @param {string | null | undefined} url */
export function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * A stored key: `{"key","origin"}` for one tied to an address, or the bare key (fixed-address providers, and keys
 * saved before keys knew their address, which have no origin yet).
 * @param {string} stored @returns {{ key: string, origin: string | null }}
 */
export function keyRecord(stored) {
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed.key === "string") return { key: parsed.key, origin: typeof parsed.origin === "string" ? parsed.origin : null };
  } catch {}
  return { key: stored, origin: null };
}

/**
 * Electron's asynchronous API returns { result, shouldReEncrypt }, not a string.
 * Existing synchronous ciphertext may still need the legacy decryptor. Reading a
 * key for a benchmark must never rotate or rewrite the owner's saved key.
 * @param {{ decryptStringAsync?: (encrypted: Buffer) => Promise<{ result: string } | string>, decryptString: (encrypted: Buffer) => string }} storage
 * @param {Buffer} encrypted
 */
export async function decryptKeyRecord(storage, encrypted) {
  let text;
  if (storage.decryptStringAsync) {
    try {
      const decoded = await storage.decryptStringAsync(encrypted);
      text = typeof decoded === "string" ? decoded : decoded?.result;
    } catch { /* Older ciphertext can require the synchronous path. */ }
  }
  if (typeof text !== "string") text = storage.decryptString(encrypted);
  if (!text) throw new Error("The saved key could not be unlocked.");
  return keyRecord(text);
}

/** Only OS-encrypted key metadata may accompany an isolated benchmark profile. */
export function keyProfileState(state) {
  const crypt = state?.os_crypt;
  const encrypted = {};
  for (const name of ["encrypted_key", "app_bound_encrypted_key"]) {
    if (typeof crypt?.[name] === "string") encrypted[name] = crypt[name];
  }
  if (!Object.keys(encrypted).length) return null;
  if (typeof crypt.audit_enabled === "boolean") encrypted.audit_enabled = crypt.audit_enabled;
  return { os_crypt: encrypted };
}

/**
 * The key to send to `url`: the saved one when it was saved for that origin (or before keys knew their address),
 * else none.
 * @param {{ key: string, origin: string | null }} saved @param {string | null | undefined} url
 */
export function keyFor(saved, url) {
  if (!saved.origin) return saved.key;
  return saved.origin === originOf(url) ? saved.key : null;
}
