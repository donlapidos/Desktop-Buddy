// Buddy's microphone and speaker as one explicit machine, so they can't get in each other's way. voice.js asks it
// before every move and keeps nothing of its own about who has them.
//
//   ear (Buddy's own microphone):  off ──open──▶ listening | dictating ──close(that take)──▶ off
//   mouth (Buddy's voice):          quiet ──speak──▶ speaking ──quiet──▶ quiet
//   meeting notes:                  on or off (meeting.js has the microphone then, through its own page)
//
// The rules:
// - Buddy speaks only while its ear is off and no meeting is being taken: its voice would be heard back (and typed, in
//   dictation) or end up in the meeting's transcript.
// - The ear opens only when it's off. (During a meeting it may: that's the user asking Buddy something.)
// - Each opening is a take with its own number; what the voice page sends back counts only for the take still open,
//   so a result from a take that was cancelled can't end the next one.
/** @typedef {"off" | "listening" | "dictating"} Ear */
/** @typedef {"quiet" | "speaking"} Mouth */

/** @param {{ trace?: (entry: object) => void }} [o] */
export function createSound({ trace = () => {} } = {}) {
  /** @type {Ear} */
  let ear = "off";
  /** @type {Mouth} */
  let mouth = "quiet";
  let meeting = false;
  let take = 0;
  const refuse = (/** @type {string} */ what) => (trace({ kind: "sound-refused", what, ear, mouth, meeting }), false);
  return {
    get ear() {
      return ear;
    },
    get mouth() {
      return mouth;
    },
    get meeting() {
      return meeting;
    },
    /** The take open now (0 when the ear is off). */
    get take() {
      return ear === "off" ? 0 : take;
    },
    mayOpen: () => ear === "off",
    maySpeak: () => ear === "off" && !meeting,
    /** Opens the ear for listening or dictation. Resolves the take's number, or 0 when refused. @param {Exclude<Ear, "off">} how */
    open(how) {
      if (ear !== "off") return (refuse(`open ${how}`), 0);
      ear = how;
      return ++take;
    },
    /** Closes the ear, if `n` is the take that's open. Resolves whether it was. @param {number} n */
    close(n) {
      if (ear === "off" || n !== take) return false;
      ear = "off";
      return true;
    },
    /** Whether `n` is the take open now. @param {number} n */
    current: (/** @type {number} */ n) => ear !== "off" && n === take,
    /** Starts speaking, if Buddy may. Resolves whether it did. */
    speak() {
      if (ear !== "off" || meeting) return refuse("speak");
      mouth = "speaking";
      return true;
    },
    quiet() {
      mouth = "quiet";
    },
    /** @param {boolean} on */
    setMeeting(on) {
      meeting = !!on;
    },
  };
}
