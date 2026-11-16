// Runs the model check (scripts/eval.mjs) with the key saved in Buddy, for owners who entered it in Settings rather
// than keeping it in an environment variable. Runs on Electron, as Buddy, because only Buddy's own login can unlock a
// saved key (Windows' data protection, through Electron's safeStorage). The key goes to the check for this run only
// and is never printed.
//   npm run eval:saved -- --provider openai --model gpt-6.1-sol --set real
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app, safeStorage } from "electron";
import { decryptKeyRecord, keyProfileState } from "../src/keys.js";

// Read the key and its OS-encrypted metadata from Buddy's profile. Chromium's
// cache and session belong to this process, avoiding contention with an active Buddy.
const savedData = path.join(app.getPath("appData"), "desktop-buddy");
const runtimeData = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-eval-"));
// Windows ciphertext depends on the profile's OS-encrypted encryption key.
// Carry only that metadata into the private runtime, never the owner's full profile.
const stateFile = path.join(savedData, "Local State");
const needsKey = !process.argv.includes("--list") && !process.argv.includes("--rescore");
if (needsKey && fs.existsSync(stateFile)) {
  try {
    const state = keyProfileState(JSON.parse(fs.readFileSync(stateFile, "utf8")));
    if (state) fs.writeFileSync(path.join(runtimeData, "Local State"), JSON.stringify(state), { flag: "wx" });
  } catch {
    console.error("Couldn't prepare the encrypted key metadata. No API request was made; Buddy's profile was not changed.");
    process.exit(2);
  }
}
app.setPath("userData", runtimeData);
app.setPath("sessionData", runtimeData);
// Not awaited at the top: in an ES module entry, Electron is only ready once the module has finished loading.
app.whenReady().then(async () => {
  if (process.argv.includes("--list") || process.argv.includes("--rescore")) {
    await import("./eval.mjs");
    return;
  }
  const at = process.argv.indexOf("--provider");
  const provider = at >= 0 ? process.argv[at + 1] : "";
  const file = path.join(savedData, provider === "anthropic" ? "api-key.bin" : `api-key-${provider}.bin`);
  let key = null;
  try {
    key = (await decryptKeyRecord(safeStorage, fs.readFileSync(file)))?.key ?? null;
  } catch {
    console.error(`Couldn't unlock the saved ${provider || "provider"} key. No API request was made; the saved key was not changed.`);
    app.exit(2);
    return;
  }
  if (!key) {
    console.error(`No ${provider || "provider"} key is saved in Buddy (Settings › AI & privacy).`);
    app.exit(2);
    return;
  }
  process.env.BUDDY_EVAL_KEY = key;
  // eval.mjs reads its options from the command line and exits with the result.
  await import("./eval.mjs");
});
