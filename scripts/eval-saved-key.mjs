// Runs the model check (scripts/eval.mjs) with the key saved in Buddy, for owners who entered it in Settings rather
// than keeping it in an environment variable. Runs on Electron, as Buddy, because only Buddy's own login can unlock a
// saved key (Windows' data protection, through Electron's safeStorage). The key goes to the check for this run only
// and is never printed.
//   npm run eval:saved -- --provider openai --model gpt-6.1-sol --set real
import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { keyRecord } from "../src/keys.js";

app.setPath("userData", path.join(app.getPath("appData"), "desktop-buddy"));
// Not awaited at the top: in an ES module entry, Electron is only ready once the module has finished loading.
app.whenReady().then(async () => {
  const at = process.argv.indexOf("--provider");
  const provider = at >= 0 ? process.argv[at + 1] : "";
  const file = path.join(app.getPath("userData"), provider === "anthropic" ? "api-key.bin" : `api-key-${provider}.bin`);
  let key = null;
  try {
    key = keyRecord(safeStorage.decryptString(fs.readFileSync(file)))?.key ?? null;
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
