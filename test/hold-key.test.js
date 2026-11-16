import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLD_MS, RELEASE_TIMEOUT_MS, createHoldKey, releaseCodes } from "../src/hold-key.js";

// A stand-in for the keyboard hook: records whether it is installed, and lets a test let go of a key.
function standIn() {
  const hook = { installed: false, starts: 0, onKeyUp: /** @type {((code: number) => void) | null} */ (null),
    start(onKeyUp) { this.installed = true; this.starts++; this.onKeyUp = onKeyUp; },
    stop() { this.installed = false; this.onKeyUp = null; },
    release(code) { this.onKeyUp?.(code); } };
  const events = [];
  const key = createHoldKey({ hook, onTap: () => events.push("tap"), onHoldStart: () => events.push("hold"), onHoldEnd: ({ timedOut }) => events.push(timedOut ? "end:timeout" : "end") });
  return { hook, key, events };
}
const SPACE = 57, CTRL = 29, ALT = 56, K = 37;

test("the keyboard hook is never installed while Buddy is idle: only from the press until the release", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hook, key, events } = standIn();
  assert.equal(hook.installed, false, "idle: no hook");
  assert.equal(hook.starts, 0);
  key.pressed("Control+Alt+Space");
  assert.equal(hook.installed, true, "installed while the key is down");
  hook.release(SPACE);
  assert.equal(hook.installed, false, "removed at the release");
  t.mock.timers.tick(RELEASE_TIMEOUT_MS * 2);
  assert.equal(hook.installed, false, "still idle afterwards");
  assert.deepEqual(events, ["tap"]);
});

test("a short press is a tap; a long one starts and ends a hold, whichever key of the combination is let go first", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hook, key, events } = standIn();
  key.pressed("Control+Alt+Space");
  t.mock.timers.tick(HOLD_MS - 10);
  hook.release(SPACE);
  key.pressed("Control+Alt+Space");
  t.mock.timers.tick(HOLD_MS);
  hook.release(K); // another key: not this shortcut's
  assert.equal(hook.installed, true);
  hook.release(CTRL);
  assert.deepEqual(events, ["tap", "hold", "end"]);
  assert.equal(hook.installed, false);
});

test("a release that never arrives times out: the hold ends and the hook is removed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hook, key, events } = standIn();
  key.pressed("Control+Alt+Space");
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(events, ["hold"]);
  t.mock.timers.tick(RELEASE_TIMEOUT_MS);
  assert.deepEqual(events, ["hold", "end:timeout"]);
  assert.equal(hook.installed, false);
  hook.release(SPACE); // late: ignored
  assert.deepEqual(events, ["hold", "end:timeout"]);
});

test("repeats while held are ignored; a shortcut whose key Buddy can't watch isn't hooked at all", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { hook, key } = standIn();
  key.pressed("Control+Alt+Space");
  key.pressed("Control+Alt+Space");
  assert.equal(hook.starts, 1);
  hook.release(ALT);
  assert.equal(key.pressed("Control+Alt+Numpad7"), false);
  assert.equal(hook.installed, false);
});

test("release codes cover the key and every modifier", () => {
  assert.deepEqual([...(releaseCodes("Control+Alt+B") ?? [])].sort((a, b) => a - b), [29, 48, 56, 3613, 3640]);
  assert.deepEqual([...(releaseCodes("Alt+Shift+F9") ?? [])].sort((a, b) => a - b), [42, 54, 56, 67, 3640]);
  assert.equal(releaseCodes("Control+Alt+Plus"), null);
});
