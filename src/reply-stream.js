// Display model text as it arrives, and speak complete sentences in order. Each sentence is handed over the moment
// it's complete, the ones after the first joining what Buddy is already saying (voice.js say's `join`), so the next one
// is made into audio while the one before plays. Cancelling hushes the voice, which drops everything handed over.
import { speakable } from "./speakable.js";

/** @param {{ display: (text: string) => void, speak: (text: string, how: { join: boolean }) => Promise<void>, hush: () => void, canSpeak: () => boolean }} ui */
export function createReplyStream(ui) {
  let text = "";
  let consumed = 0;
  let spoken = false;
  let active = false;
  let queue = Promise.resolve(); // the speech handed over last: settled when it has been said

  function cancel() {
    active = false;
    queue = Promise.resolve();
    if (spoken) ui.hush();
    spoken = false;
  }

  // `{ text: "" }` starts a new answer: whatever was being said stops. `{ text: "", next: true }` is the same answer's
  // next step (after a tool): its text starts from the top, and what's being said or waiting to be said carries on.
  function receive(update) {
    if (!update.text && !update.done) {
      if (!update.next) cancel();
      else if (!active) return;
      active = true;
      text = "";
      consumed = 0;
      return;
    }
    if (!active) return;
    text = update.text;
    if (text) ui.display(text);
    if (!ui.canSpeak()) return;
    // A partial Markdown block is unsafe to turn into speech; wait for the complete block in those replies.
    const remaining = text.slice(consumed);
    const rich = /```|^\s*\|/m.test(remaining);
    const boundary = rich ? null : /[.!?](?:["'\u201d\u2019])?\s+/.exec(remaining);
    if (!update.done && !boundary) return;
    const end = update.done ? text.length : consumed + boundary.index + boundary[0].length;
    const sentence = speakable(text.slice(consumed, end));
    consumed = end;
    if (!sentence) return;
    const join = spoken;
    spoken = true;
    queue = ui.speak(sentence, { join }).catch(() => {});
  }

  return {
    receive,
    cancel,
    // The final answer has already been queued; don't read it a second time. Tool closing lines still speak normally.
    covers: (reply) => active && spoken && text.trim() === reply.trim(),
    settled: () => queue,
  };
}
