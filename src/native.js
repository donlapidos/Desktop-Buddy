// Buddy's two native helpers, the commands' wall launcher (wall.ps1) and live marking's overlay (marker-live.js), are
// built when Buddy is released (scripts/build-native.mjs) and installed in resources/native, so nothing is compiled on
// the user's PC: security tools rightly distrust an app that compiles a program and runs it. Each is named by a
// fingerprint of its source, so one that doesn't match the running Buddy is never used. Buddy run from source has none
// there and compiles them itself, once, into its data folder.
import fs from "node:fs";
import path from "node:path";

/** Where the installer puts the helpers, or null outside an installed Buddy (from source, or under plain Node). */
export const SHIPPED_NATIVE = (() => {
  const dir = process.resourcesPath ? path.join(process.resourcesPath, "native") : null;
  return dir && fs.existsSync(dir) ? dir : null;
})();
