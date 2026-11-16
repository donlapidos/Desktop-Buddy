// Runs the model check (scripts/eval.mjs) with the key saved in Buddy, for owners who entered it in Settings rather
// than keeping it in an environment variable. Runs on Electron, as Buddy, because only Buddy's own login can unlock a
// saved key (Windows' data protection, through Electron's safeStorage). The key goes to the check for this run only
// and is never printed.
//   npm run eval:saved -- --provider openai --model gpt-6.1-sol --set real
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { app, safeStorage } from "electron";
import { keyRecord } from "../src/keys.js";

// Only the key is read from Buddy's profile. Chromium's cache and session belong
// to this process, so an active Buddy never competes with the benchmark for them.
const savedData = path.join(app.getPath("appData"), "desktop-buddy");
const runtimeData = fs.mkdtempSync(path.join(os.tmpdir(), "buddy-eval-"));
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
    key = keyRecord(await safeStorage.decryptStringAsync(fs.readFileSync(file)))?.key ?? null;
  } catch {}
  if (!key) {
    console.error(`No ${provider || "provider"} key is saved in Buddy (Settings › AI & privacy).`);
    app.exit(2);
    return;
  }
  process.env.BUDDY_EVAL_KEY = key;
  // eval.mjs reads its options from the command line and exits with the result.
  await import("./eval.mjs");
});
