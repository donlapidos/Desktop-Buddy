// Launching without a terminal: Start menu and desktop shortcuts, and starting with Windows.
import { app, shell } from "electron";
import path from "node:path";

// Installed, Buddy is its own "Desktop Buddy.exe" and the installer makes its shortcuts. From a source checkout it runs
// as `electron <app dir>`, so every launcher passes the app directory to the Electron binary.
const LAUNCH = app.isPackaged ? { path: process.execPath, args: [] } : { path: process.execPath, args: [app.getAppPath()] };

export const startsWithWindows = () => app.getLoginItemSettings(LAUNCH).openAtLogin;
export const setStartsWithWindows = (/** @type {boolean} */ on) => app.setLoginItemSettings({ openAtLogin: on, ...LAUNCH });

/**
 * Writes Buddy's Start menu and desktop shortcuts; whether each was written.
 * @param {{ icon: string, appId: string, description: string }} link
 */
export function writeShortcuts({ icon, appId, description }) {
  const shortcut = {
    target: LAUNCH.path,
    args: `"${LAUNCH.args[0]}"`,
    icon,
    iconIndex: 0,
    appUserModelId: appId,
    description,
  };
  const startMenu = path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Desktop Buddy.lnk");
  const desktop = path.join(app.getPath("desktop"), "Desktop Buddy.lnk");
  // "create" writes or overwrites; "replace" only overwrites an existing link, so it silently made nothing.
  return [startMenu, desktop].map((file) => {
    const ok = shell.writeShortcutLink(file, "create", shortcut);
    if (!ok) console.error(`Could not write ${file}`);
    return ok;
  });
}
