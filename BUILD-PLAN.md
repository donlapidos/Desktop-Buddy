# Desktop Buddy build plan: closing the gap to heyclicky

Written 2026-11-16, after an assessment of the code, docs, the owner's timing log and the public repository. This is
a work order for an agent to carry out with the owner. `ROADMAP.md` stays the long list; this says what to build
next, in what order, and how to tell each piece is done. Where a package repeats a roadmap item, the number is given.

Read `CLAUDE.md` first: its rules (prove each protection, checks before every commit, test copies, plain words,
publishing is the owner's) apply to every package here.

## Why this plan

heyclicky today: Mac and Windows, download and sign in, 25 free messages a month, one hotkey, talk and it answers
aloud while drawing on the screen, "works with anything on screen", 80,000+ claimed users, $0 / $20 / $100 plans.

Buddy today, measured:

| Fact | Evidence |
|---|---|
| Nobody uses it | 0 stars, 0 issues, 3 installer downloads per release |
| The newest work is unreleased | Streaming, drawings, screen context and Mark speed-ups sit under "Unreleased" in `CHANGELOG.md` |
| First pointer takes about 5 s | Owner's timing log: window read median 1.3 s (p90 3.3 s), model turn median 2.5 s (p90 5.4 s), pointer flight 0.9 s. Added up, not measured end to end |
| Voice is a side door | 4 voice requests in the whole log; five separate Ctrl+Alt shortcuts; 275 MB of models fetched on first Talk |
| No pointing without an accessibility tree | `README.md`: "Buddy can explain its screenshot but cannot anchor these drawings yet" |
| Setup needs an AI app, a local model or a key | `src/welcome.js`; the one free cloud path (Gemini) has never run live |
| `src/main.js` is 2,684 lines | About 480 of them are `BUDDY_*_TEST` hooks (from line 2142 on) |
| The base is sound | `npm run check` clean, 291 unit tests pass (2026-11-16). End-to-end checks were not run for this plan |

Buddy's edges, to keep and lead with: pointing that follows the user step by step from the accessibility tree,
approvals and undo, voice on the PC, any AI including local ones, open source.

**Target:** a stranger installs Buddy, holds one key, asks out loud, and sees the pointer on the right control in
under 3 seconds, in any app, without a credit card.

## Order

| # | Package | Needs the owner | Touches `main.js` |
|---|---|---|---|
| 0 | Measure ask-to-pointer | no | a little |
| 1 | Move the test hooks out of `main.js` | no | heavily |
| 2 | Ship 0.4.0 and show it | recording, tag, publish | no |
| 3 | Speed: first pointer under 3 s | no | some |
| 4 | Voice first: hold one key and talk | one decision (4.1) | yes |
| 5 | A narrower first screen | no | some |
| 6 | Free start and proof on more models | keys | no |
| 7 | Point by sight when there is no tree | no | yes |
| 8 | Problem report | no | some |

Do 0 and 1 first: 0 gives the number every later package is judged by, and 1 makes `main.js` safe to change. 2 can
run beside them (it changes docs and release files only). 3, 4, 5 and 7 all touch `main.js`: do them one at a time.
6 is independent once the owner supplies keys.

---

## 0. Measure ask-to-pointer

**Why:** speed is the product for a guide, and today the number is added up from parts.

**Where:** `src/brain.js` (it already writes `kind: "model"` at line 945 and `kind: "tool"` at 966), `src/log.js`,
`scripts/`.

**Build:**
- One timing entry per question, `kind: "first-pointer"`: milliseconds from the question being accepted (Send
  pressed, or end of speech) to the pointer or first guide highlight being shown, split into `contextMs`,
  `modelMs`, `pointMs`, with `voice: true|false`, the provider and model. No window text, no image data.
- For spoken questions also `heardMs` (speech to text) and `firstAudioMs` (first spoken sound).
- `npm run measure:latency`: reads a timing log (default the owner's, or `--file`) and prints count, median and
  p90 for each field, per model.

**Done when:** a unit test feeds the summariser a made-up log and checks the numbers; the `conversation` e2e check
fails if a guided answer leaves no `first-pointer` entry; the baseline from the owner's own use is written into
this file under "Results".

## 1. Move the test hooks out of `main.js` (roadmap 4.1, first half)

**Why:** packages 3, 4, 5 and 7 all change `main.js`. The hooks are a fifth of it and grow with every feature.

**Where:** `src/main.js` from the `devRun` line (2142) to the end of the `BUDDY_*_TEST` chain; new
`src/dev-hooks.js`.

**Build:** move each hook into `src/dev-hooks.js`, loaded with a dynamic import only when one of the variables is
set. Hand it what it needs as one typed object (the pattern `annotation-test.js` and `marker-test.js` already
use). No behaviour change, one hook family per commit.

**Done when:** `npm run check`, `npm test` and the whole of `npm run e2e` pass after each move; `main.js` is under
2,250 lines; starting Buddy with no test variable never loads `dev-hooks.js` (a unit or e2e check holds this).

**Not in this package:** splitting the rest of `main.js` by area. Do that only where a later package needs it.

## 2. Ship 0.4.0 and show it (roadmap 1.3, 1.4)

**Why:** people decide in ten seconds, and what they would install today lacks the best work.

**Build (agent):**
- `CHANGELOG.md`: turn "Unreleased" into 0.4.0 with a three-line summary on top; bump `package.json`.
- `README.md`: the first screen is for someone who is not a developer: one sentence on what Buddy is, the
  recording, three screenshots (pointer with caption, approval card, Mark), the download button, three ways to
  start. Move everything from "Release" down to `docs/DEVELOPING.md`. Aim for under 90 lines.
- Drop "Clicky-style" from `README.md` line 3 and `package.json` line 4. Lead with Buddy's own claim, for example
  "Shows you where to click, in any Windows app, with the AI you choose."
- A one-page site in `docs/` for GitHub Pages: the recording, the download button, the privacy summary.
- A winget manifest, ready to submit.
- Signing: wire the certificate into `.github/workflows/release.yml` (sign, then rebuild `latest.yml` from the
  signed installer) behind secrets, so an unsigned build still works until the certificate exists.

**Owner:** record 30 seconds of a guided Excel task; buy the certificate (Certum open-source was the earlier
finding; check the price); tag and publish; turn on Pages; submit winget.

**Done when:** the draft release builds from the tag; the README renders with real media; nothing the owner must
do is left undocumented. The agent hands over the exact commands and stops there.

## 3. Speed: first pointer under 3 s

**Why:** about 5 s today against a competitor that feels immediate.

**Where:** `src/brain.js` (`glance` at 735, `collectScreenContext` call at 786, the tool loop), `src/desktop.js`
(`run` at 75 starts a new `agent-desktop.exe` for every read), `src/screen-context.js`, `src/providers.js`.

**Build, in this order, measuring with package 0 after each step and keeping only what moves the number:**
1. **Reuse the glance.** `summon()` already calls `brain.glance(win)` when the bubble opens. Check, from the new
   timing entry, whether the question then waits on a second read or capture. If it does, reuse the glance when
   the window has not changed (same window id, title and bounds) and it is under about 3 s old. Do the same for
   Talk: start the read when listening starts, not when speech ends.
2. **Fewer process starts.** Time a bare `agent-desktop version` call to learn what a process start costs here.
   If it is over about 150 ms, fold calls that always go together (window list, then snapshot) into one
   `agent-desktop batch` call. agent-desktop 1.2.0 has no long-running mode; do not build one.
3. **Start pointing before the model finishes.** Tools wait for complete arguments today. For `guide_steps` and
   `point_at`, read the first target from the arguments as they stream and start the pointer once that step is
   complete. Guide and point only: anything that acts still waits for full arguments and its approval. Prove it:
   a test where a streamed `act` call is cut short must show no action and no card.
4. **A quick model for guiding (roadmap 5.5).** An optional second model per provider, used for guide requests,
   with the main one kept for Explain plates and tasks. Offer it only for models that pass package 6's bar.

**Done when:** median `first-pointer` is under 3 s for typed questions on the owner's model, on the six recorded
workflows and on at least 20 real questions from the owner's use; pass rates on `--set real` and `--set workflows`
are unchanged; before and after are written under "Results".

## 4. Voice first: hold one key and talk

**Why:** this is the whole of heyclicky's interaction. Buddy has it, behind a second shortcut and a first-use
download.

**Where:** `src/main.js` shortcuts (`HOTKEY_ACTIONS`, `registerHotkeys`, about line 1876), `src/voice.js`
(models are fetched at line 269 when first needed), `src/welcome.js`, `src/ui/bubble.html`, `src/settings.js`.

**Build:**
- **4.1 Hold to talk.** Electron's global shortcuts report a press but never a release. Detecting release needs a
  low-level keyboard hook. Keep the trust story: start the hook only when the Talk shortcut is pressed and remove
  it at release, so Buddy never watches the keyboard while idle. *Owner's decision:* add a native dependency for
  this (for example `uiohook-napi`, pinned, licence checked, listed in `THIRD_PARTY_NOTICES.md`), or keep
  press-to-start with stop-at-pause. Recommended: add it. A short press keeps today's behaviour.
- **4.2 One main key.** The same shortcut: tap opens the bubble to type, hold talks. Ask and Talk stay separately
  assignable in Settings for people who changed them; new profiles get the single key. Mark, Explain and Dictate
  keep theirs.
- **4.3 Voice ready at setup.** After the welcome's last step, offer "Set up talking (275 MB, about a minute)"
  with progress in the bubble, fetched in the background. Declining is fine; first Talk fetches as it does today.
- **4.4 Say what was heard, at once.** Show the heard sentence in the bubble as soon as it exists, before the
  model answers.

**Done when:** the `voice` e2e check covers hold and release with a stand-in for the hook, and a release that
never arrives times out and stops listening; a test proves the hook is not installed while Buddy is idle (break
it on purpose and see the test fail); the `welcome` e2e check walks the voice offer both ways; median
speech-end-to-first-pointer is under 3.5 s in the owner's log.

## 5. A narrower first screen

**Why:** a new user meets Ask, Talk, Mark, Task, routines, agents' rules, commands and documents. The owner's log
shows the core loop is nearly all that gets used.

**Where:** `src/settings.js`, `src/ui/island.html`, `src/ui/settings.html`, the tool list in `src/brain.js`.

**Build:** one setting, "Show advanced features", off for new profiles and on for existing ones. Off: the island
offers Ask/Talk and Mark; Settings hides Routines and the task controls; the model is not offered task, routine
or document tools (a shorter tool list is also a faster first answer). Nothing is removed, and Do mode with its
approvals stays.

**Done when:** a unit test holds the tool list for each state; the `firstrun` e2e check captures the island of a
new profile showing only the core actions; an existing profile sees no change.

## 6. Free start and proof on more models (roadmap 2.3, 2.6)

**Why:** "any AI" is tested live on Claude and one OpenAI model. Gemini's free tier is the only way a stranger
without an AI app or a strong PC starts without paying, and it has never been run.

**Owner:** a Google AI Studio key, an Anthropic key for Haiku 5.5, and one local model installed. Personal
accounts only.

**Build:**
- Run `npm run eval -- --provider <id> --model <id> --set real` and `--set workflows` for one Gemini model,
  Haiku 5.5 and one local model. Fix what breaks in `src/providers.js`. Save each run with `--json`.
- A table in the README: model, tasks passed, seconds a task, cost a task. Settings' "works well" mark comes from
  this table, not from the model's family name.
- If Gemini passes 90% and its free tier is confirmed on the day: the welcome's key page gains "Get a free key
  from Google" with the steps in plain words and the date it was checked. If not, promise nothing.
- Injection cases in the real set (roadmap 2.6): window text, a web page and a file that tell Buddy to act. Each
  must end with no action or a card that says plainly what would happen.
- Small: OpenAI answers show tokens but no cost (`spend.json` has 10 unpriced calls). Add a dated price table for
  OpenAI in `src/costs.js` like Anthropic's, or leave it and say so in Settings.

**Done when:** the table is in the README with dates; the bar for "works well" is one constant with a test; the
injection cases run in `npm test` against scripted replies, both ways.

## 7. Point by sight when there is no tree

**Why:** heyclicky claims any app. Buddy goes quiet on canvases, games, remote desktops and apps with poor
accessibility.

**Where:** `src/brain.js` (`point_at`, annotations), `src/geometry.js`, `src/annotations.js`,
`src/screen-context.js`, `src/evals.js`.

**Build:**
- When the window's read comes back nearly empty, or the wanted thing has no control, and the model can see
  images: `point_at` and `annotate` accept a spot on the screenshot Buddy sent (fractions of its width and
  height). Convert through `geometry.js` only, as for every other coordinate.
- Show it differently (a soft ring, "about here") so the user knows it is a best guess.
- These drawings clear on window move, resize, scroll input or focus loss, since there is no control to follow.
- **Protection:** a spot is never accepted by `act`. Do mode stays tied to controls and approval slips. Prove
  it: a test hands `act` a spot and must see a refusal; remove the rule and see the test fail.
- Checks: reuse the test-owned chart window from the `context` e2e check and assert the pointer lands inside the
  named bar. Add four or five recorded screenshots (a canvas, a PDF, a remote-desktop still) to the eval set with
  target boxes.

**Done when:** the e2e check passes on the owner's model; the eval reports hit rate inside the target box per
model; the README's "cannot anchor these drawings yet" line is replaced with what is true.

## 8. Problem report (roadmap 3.3)

**Why:** with no telemetry, this is the only way to learn what went wrong for someone else.

**Build:** "Report a problem" in the tray and Settings: gathers the version, settings without keys or addresses,
and the timing log's tail; shows exactly what would be sent; then opens a pre-filled issue or copies it. Nothing
is sent without the user pressing the button.

**Done when:** a unit test proves keys, key-shaped text and file paths under the user's profile are left out;
the `settings` e2e check opens the preview.

---

## Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 2 | Wording that replaces "Clicky-style" | "Shows you where to click, in any Windows app, with the AI you choose" |
| 2 | Buy a signing certificate | Yes, in your own name |
| 4.1 | A native keyboard-hook dependency for hold-to-talk | Yes, live only while the key is held |
| 6 | Which accounts fund the model runs | Personal Gemini and Anthropic keys, one local model |
| - | Compete as a hosted product (relay, accounts, billing) or as the open, private alternative | The open alternative first; revisit Buddy Plus when downloads pass 100 a release |

## Not checked for this plan

- Buddy was not run and its windows were not looked at: nothing here judges look and feel.
- `npm run e2e` was not run.
- What starting an `agent-desktop` process costs, and whether a question re-reads the window after the glance:
  package 3 measures both before changing anything.
- heyclicky's facts come from its own site and listings on 2026-11-16, not from using it.

## Results

Fill in as packages land: date, package, the number before and after, the command that produced it.

**2026-11-16 · package 0 · baseline.** The owner's log has no `first-pointer` entries yet (they start with this
build), so the baseline is rebuilt from the older `model` and `tool` entries: a question starts after 20 s of quiet,
and its ask-to-pointer time is its window reads plus its model calls up to the first one that points, plus 0.9 s of
pointer flight. 8 of 28 questions in the log pointed.

| Part | Median | p90 |
|---|---|---|
| Window reads before pointing | 1.5 s | 14.8 s |
| Model calls before pointing | 4.5 s (2 calls) | 10.6 s (5 calls) |
| Ask to pointer (rebuilt) | 6.6 s | 26.3 s |

Measured, not rebuilt, from here on: `npm run measure:latency` after the owner has used this build for a while.
The `conversation` e2e check fails if a guided answer leaves no `first-pointer` entry (checked by switching the clock
off: it failed with "a guided answer left no first-pointer entry in the timing log").

**2026-11-16 · package 3 · speed, steps 1 to 3.** Measured with the `conversation` e2e check: a guided question in
a test-owned sample window, answered by a scripted model that replies at once, so the numbers are Buddy's own share
of the wait (the model's share comes on top).

| | Window read before the model (`contextMs`) | Ask to pointer (`ms`) |
|---|---|---|
| Before (question re-read the window) | 1.34 s | 2.26 s |
| After (glance reused) | 0.02 s | 0.95 s (0.91 s of it is the pointer's flight) |

- Step 1, reuse the glance: the glance was used only for a question asked within 2 s of the bubble opening, so
  nearly every typed question read the window twice. It is now used for 30 s unless the bubble loses focus (the
  user went back to their window), it also takes the screenshot for models that can see, and Talk starts one when
  listening starts with the bubble already open. Kept.
- Step 2, process starts: a bare `agent-desktop version` costs about 0.2 s from Node here, `list-windows` about
  0.65 s. The calls on the ask-to-pointer path don't come in fixed pairs (the window list runs when the bubble
  opens, before the question), so a batch saves nothing there. What did: `guide_steps` read the window again
  before its first step; it now starts from the model's last read when it is under 15 s old, and the highlight
  still checks the control's live position before it is drawn. Kept.
- Step 3, point while the model writes: `guide_steps` shows its first step, and `point_at` its pointer, as soon
  as that part of the call is complete, for Anthropic, OpenAI and Chat Completions streams. Nothing that acts
  starts early: a unit test streams an `act` call, cuts it short and sees no card and no action (with the rule
  broken on purpose it failed). The gain grows with route length, so it can't show up in the instant scripted
  model above; it will in the owner's log. Kept.
- Step 4, a quick model for guiding: not done. It is to be offered only for models that pass package 6's bar,
  and package 6 needs the owner's keys.

Still to do for "done": median `first-pointer` under 3 s on the owner's model, from `npm run measure:latency`
after real use, and `npm run eval -- --set real` / `--set workflows` pass rates unchanged. Both spend the owner's
model credit, so they are the owner's to run.

**2026-11-16 · package 4 · voice first.** Owner's decision: add the native hook. `uiohook-napi` 1.5.5 (MIT),
pinned; it compiles in libuiohook, which is LGPL-3.0-or-later, so it ships as its own replaceable file outside the
app archive, with the notice and source link in `THIRD_PARTY_NOTICES.md`.
- 4.1 Hold to talk: holding Ask or Talk keeps listening through pauses until the key is let go; a short press
  does what it did. The hook is installed at the press and removed at the release or after 30 s. Unit test: the hook
  is never installed while idle (with removal broken on purpose, 4 of 5 tests failed). The `voice` e2e check drives
  the real shortcut handling with a stand-in hook: hold and release, a tap, and a release that never arrives.
- 4.2 One main key: Ask is the main key (tap to type, hold to talk); Talk keeps its own shortcut. Settings ›
  Shortcuts › Hold to talk switches it off.
- 4.3 Voice ready at setup: the 275 MB were in fact fetched without asking, 4 s after the first start. A new
  profile is now asked once setup is done ("Set up talking" or "Not now", with progress in the bubble); profiles from
  before keep fetching in the background as they did. The `welcome` e2e check walks both answers.
- 4.4 What was heard: the bubble already showed the heard sentence at once; checked, unchanged.
- Still to measure: median speech-end-to-first-pointer under 3.5 s, from `npm run measure:latency` (spoken rows)
  after the owner has used this build.

**2026-11-16 · package 5 · a narrower first screen.** One setting, Settings › Agents › Show advanced features: off
for a new profile, on for one from before. Off, the island offers Ask, Talk and Mark (no Task), the bubble has no
Make task, the tray no New task window, Settings hides Routines and the commands switch, and the model is offered
13 tools instead of 19 (no `create_document`, files or web pages); one it calls anyway is refused with where to
turn it on. Do mode and its approvals are unchanged. A unit test holds both tool lists (with the refusal removed
on purpose, it failed); the new `island` e2e check pictures a new profile's island (Ask, Talk, Mark) and a seeded
older profile's (Ask, Talk, Mark, Task).
