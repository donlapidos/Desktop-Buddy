import assert from "node:assert/strict";
import { test } from "node:test";
import { createSound } from "../src/sound.js";

// Buddy's microphone and speaker (sound.js): who may have them, and when.

test("Buddy speaks only with its microphone off and no meeting on", () => {
  const refused = [];
  const s = createSound({ trace: (e) => refused.push(e.what) });
  assert.ok(s.maySpeak());
  assert.equal(s.speak(), true);
  assert.equal(s.mouth, "speaking");
  s.quiet();
  const take = s.open("dictating");
  assert.equal(s.maySpeak(), false);
  assert.equal(s.speak(), false, "never into an open microphone");
  assert.equal(s.mouth, "quiet");
  s.close(take);
  s.setMeeting(true);
  assert.equal(s.speak(), false, "never during a meeting");
  s.setMeeting(false);
  assert.equal(s.speak(), true);
  assert.deepEqual(refused, ["speak", "speak"], "each refusal is logged");
});

test("the microphone opens once at a time, a take closes only itself, and a meeting doesn't stop the user asking", () => {
  const s = createSound();
  const first = s.open("listening");
  assert.ok(first > 0);
  assert.equal(s.ear, "listening");
  assert.equal(s.open("dictating"), 0, "already open");
  assert.equal(s.take, first);
  // A cancelled take's late answer: by the time it arrives a new take is open, and it mustn't close that one.
  assert.equal(s.close(first), true);
  const second = s.open("listening");
  assert.notEqual(second, first);
  assert.equal(s.current(first), false);
  assert.equal(s.close(first), false, "the old take can't close the new one");
  assert.equal(s.ear, "listening");
  assert.equal(s.close(second), true);
  assert.equal(s.take, 0);
  s.setMeeting(true);
  assert.ok(s.open("listening") > 0, "asking Buddy something during a meeting is allowed");
});
