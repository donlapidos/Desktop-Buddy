// Display model text as it arrives, and speak complete sentences in order. A generation owns its speech queue:
// cancelling drops every queued sentence, including one waiting for the preceding audio to finish.
import { speakable } from "./speakable.js";

/** @param {{ display: (text: string) => void, speak: (text: string) => Promise<void>, hush: () => void, canSpeak: () => boolean }} ui */
export function createReplyStream(ui) {
  let generation = 0;
  let text = "";
  let consumed = 0;
  let spoken = false;
  let active = false;
  let queue = Promise.resolve();

  function cancel() {
    generation++;
    active = false;
    queue = Promise.resolve();
    if (spoken) ui.hush();
    spoken = false;
  }

  function receive(update) {
    if (!update.text && !update.done) {
      cancel();
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
    spoken = true;
    const mine = generation;
    queue = queue.then(async () => {
      if (mine === generation && active && ui.canSpeak()) await ui.speak(sentence);
    }).catch(() => {});
  }

  return {
    receive,
    cancel,
    // The final answer has already been queued; don't read it a second time. Tool closing lines still speak normally.
    covers: (reply) => active && spoken && text.trim() === reply.trim(),
    settled: () => queue,
  };
}
