// Hold to talk. Windows' global shortcuts report a key press but never its release, and telling a tap from a hold
// needs the release. That takes a low-level keyboard hook, which sees every key typed anywhere, so Buddy installs it
// only from the moment its shortcut is pressed until that key is let go (or a deadline passes) and never while idle.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** uiohook's key codes for the keys a shortcut can end in, and for the modifiers it may hold. */
export const KEYCODES = {
  ...Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c, i) => [c, [30, 48, 46, 32, 18, 33, 34, 35, 23, 36, 37, 38, 50, 49, 24, 25, 16, 19, 31, 20, 22, 47, 17, 45, 21, 44][i]])),
  ...Object.fromEntries("1234567890".split("").map((c, i) => [c, i + 2])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, [59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88][i]])),
  Space: 57,
};
const MODIFIERS = { Control: [29, 3613], Ctrl: [29, 3613], CommandOrControl: [29, 3613], Alt: [56, 3640], Shift: [42, 54], Super: [3675, 3676], Meta: [3675, 3676] };

/**
 * The key codes whose release ends a hold of `accelerator` ("Control+Alt+Space"): its key, and each of its modifiers,
 * since people let go of a combination in any order. Null if Buddy can't tell (the key isn't one it knows).
 * @param {string} accelerator @returns {Set<number> | null}
 */
export function releaseCodes(accelerator) {
  const parts = String(accelerator).split("+");
  const key = KEYCODES[/** @type {keyof typeof KEYCODES} */ (parts.at(-1)?.length === 1 ? parts.at(-1)?.toUpperCase() : parts.at(-1))];
  if (key == null) return null;
  return new Set([key, ...parts.slice(0, -1).flatMap((m) => MODIFIERS[m] ?? [])]);
}

/**
 * @typedef {{ start: (onKeyUp: (keycode: number) => void) => void, stop: () => void }} KeyHook
 *   A keyboard hook that reports key releases while started. Real one: uiohookHook(). Tests use a stand-in.
 */

/** A hold this long or longer is a hold; shorter is a tap. */
export const HOLD_MS = 300;
/** A release that never arrives (the hook missed it) stops the hold after this long. */
export const RELEASE_TIMEOUT_MS = 30_000;

/**
 * Tells a tap of a shortcut from a hold. pressed() is called when its global shortcut fires; it installs the hook,
 * then calls exactly one of onTap (let go before HOLD_MS) or onHoldStart followed by onHoldEnd (let go after, or
 * RELEASE_TIMEOUT_MS passed: `timedOut`). The hook is removed as soon as the key is let go or the deadline passes.
 * @param {{ hook: KeyHook, onTap: () => void, onHoldStart: () => void, onHoldEnd: (how: { timedOut: boolean }) => void,
 *   holdMs?: number, releaseTimeoutMs?: number, trace?: (entry: object) => void }} o
 */
export function createHoldKey({ hook, onTap, onHoldStart, onHoldEnd, holdMs = HOLD_MS, releaseTimeoutMs = RELEASE_TIMEOUT_MS, trace = () => {} }) {
  /** @type {{ holding: boolean, timers: ReturnType<typeof setTimeout>[] } | null} */
  let press = null;

  const end = () => {
    const p = press;
    press = null;
    if (!p) return null;
    p.timers.forEach(clearTimeout);
    try { hook.stop(); } catch (err) { trace({ kind: "hold-key-error", error: String(err) }); }
    return p;
  };

  return {
    /** The shortcut fired. Returns false (and does nothing) when it can't watch for the release of `accelerator`. */
    pressed(/** @type {string} */ accelerator) {
      if (press) return true; // a repeat while held
      const codes = releaseCodes(accelerator);
      if (!codes) return false;
      const p = { holding: false, timers: /** @type {ReturnType<typeof setTimeout>[]} */ ([]) };
      press = p;
      try {
        hook.start((keycode) => {
          if (press !== p || !codes.has(keycode)) return;
          end();
          if (p.holding) onHoldEnd({ timedOut: false });
          else onTap();
        });
      } catch (err) {
        press = null;
        trace({ kind: "hold-key-error", error: String(err) });
        return false;
      }
      p.timers.push(setTimeout(() => {
        if (press !== p) return;
        p.holding = true;
        onHoldStart();
      }, holdMs));
      p.timers.push(setTimeout(() => {
        if (press !== p) return;
        end();
        trace({ kind: "hold-key-timeout" });
        if (p.holding) onHoldEnd({ timedOut: true });
        else onTap();
      }, releaseTimeoutMs));
      return true;
    },
    /** Stops watching now (Buddy is quitting, or the shortcut changed), without calling anything. */
    cancel() {
      end();
    },
    get watching() {
      return !!press;
    },
  };
}

/** The real hook, on uiohook-napi, loaded the first time a shortcut is pressed. @returns {KeyHook} */
export function uiohookHook() {
  /** @type {any} */
  let lib = null;
  /** @type {((e: { keycode: number }) => void) | null} */
  let listener = null;
  return {
    start(onKeyUp) {
      lib ??= require("uiohook-napi").uIOhook;
      listener = (e) => onKeyUp(e.keycode);
      lib.on("keyup", listener);
      lib.start();
    },
    stop() {
      if (!lib) return;
      if (listener) lib.removeListener("keyup", listener);
      listener = null;
      lib.stop();
    },
  };
}
