# Desktop Buddy roadmap: from working app to viable product

Written 2026-11-11, after 0.2.0. This is a work plan for an agent (Claude Opus in Claude Code) to carry out with
the owner. Each task says why it matters, what to do, and how to tell it's done. Do the phases in order; inside a
phase, tasks are independent unless one names another.

**Direction (decided 2026-11-12):** Buddy stays free and open source, and may earn its keep through **Buddy Plus**, a
monthly plan with the AI included (no key: Buddy relays to a provider on the owner's own API account). It is built
only if people show they want it (task 1.6). Rules for it: never resell or route through anyone's Claude or ChatGPT
subscription; never run it on an employer's account or credits; a privacy policy before screen content passes
through a relay. A business tier (central policies, audit export, deployment) is the likely next step after that.

## Where Buddy stands

**Works and is tested** (176 unit tests, 6 end-to-end checks, each protection broken on purpose to prove its test):
guiding by pointing, Do mode with approval cards, Mark and Explain plates, voice and dictation on the PC, task
windows, routines, any provider (Anthropic, OpenAI, OpenRouter, Gemini, DeepSeek, Ollama, LM Studio, custom), Buddy's
tools in AI apps over MCP, files/PowerShell/web with Activity and undo, installer with self-update.

**Not yet proven**, and what stands between this and a product strangers can rely on:

| Gap | Evidence |
|---|---|
| Nobody but the owner has installed or used it | 0 stars, issues disabled, no screenshots in the README |
| A new user can't start without an API key or an AI app | First run asks for a key; no guided setup |
| Guide quality is unmeasured on real apps | 8 guided steps ever logged; the model check is 7 made-up windows |
| Most providers and AI apps have never run for real | Live-tested: Claude, OpenAI `gpt-6.1-sol`, Codex, Claude Code. Never: Gemini, OpenRouter, DeepSeek, Ollama, LM Studio, Cursor, VS Code, Windsurf, Gemini CLI, Claude app chat |
| The update path has never updated anything | 0.1.0 was never published; no installed copy has gone from one version to the next |
| Windows warns people off the installer | Unsigned; SmartScreen "protected your PC" |
| The repo is shared with the upstream CLI | See Phase 0 |
| `main.js` is 2,247 lines, 323 of them test hooks | Hard to change safely; the renderer pages (settings.html: 1,114 lines) are untyped |

**The bar for "viable":** a stranger on an ordinary Windows laptop installs Buddy, gets a first correct guided step
within five minutes without a terminal or a credit card, is never surprised by something Buddy did, gets updates
without thinking, and has somewhere to say what went wrong.

## Phase 0: stop the release plumbing from breaking (do first)

Buddy lives in a fork of `vercel-labs/agent-desktop`, and the two projects collide there.

- **0.1 Decide where Buddy lives.** *Owner's decision; recommended: its own repository.* In the fork: upstream's
  `Release` workflow runs on the fork whenever a sync changes `Cargo.toml` and publishes the CLI as a GitHub release,
  which would take "Latest" from Buddy and break installed copies' update check (it was cancelled by hand on
  2026-11-11, and left a stray `v1.2.0` tag); CLI and Buddy tags share one namespace (`v0.2.0` is Buddy, `v1.2.0` is
  the CLI); upstream's Audit and Linux checks show red on every Buddy PR; AGENTS.md there is written for the Rust
  crates. Own repo: Buddy depends on agent-desktop as a pinned release binary (npm `agent-desktop` or a release
  download with a checksum) instead of `../../target/release`.
  *If staying in the fork instead:* disable the `Release`, `Release dry run` and e2e workflows on the fork, delete
  the stray `v1.2.0` tag, and point electron-updater at Buddy's own tag prefix.
  *Done when:* a sync or upstream release can't change what `releases/latest/download/latest.yml` serves, and that
  is checked by a CI job.
  **Done (2026-11-12): own repository,** [donlapidos/Desktop-Buddy](https://github.com/donlapidos/Desktop-Buddy),
  with Buddy's history and tags, a pinned agent-desktop 1.2.0 (`npm run setup`), and its own CI and release
  workflows. The fork's `Release` workflow is disabled. The fork carries a bridge release v0.2.1 (the same files) so
  copies installed from it update once and then follow the new repository. Not built: a CI job that checks
  `latest.yml`.
- **0.2 Turn on Issues (or Discussions).** Settings › Request a feature opens a GitHub issue; issues are disabled, so
  the link is dead. *Done when:* the button lands on a working form.
  **Done (2026-11-12):** Issues are on in the new repository.
- **0.3 Prove an update.** Ship 0.2.1 (any small fix), install 0.2.0 from the release, and watch it find, download
  and install 0.2.1. *Done when:* that is seen once by hand and written into the release steps in the README.
  **Done (2026-11-12).** 0.2.1 is Latest on both repositories. An installed 0.2.0 (from the fork) found 0.2.1 a
  minute after starting and downloaded and verified it; the downloaded installer, run silently as the updater runs it
  on quit, updated the install in place to 0.2.1, which then checked the new repository without error. Not seen: the
  tray's **Restart to update** click itself (two Buddys were running). Written into the README's release steps.
- **0.4 Finish the two open items from the invariants review.** (a) `point_at` uses the position saved when the
  window was read and never re-checks it: after the user moves or scrolls the window, Buddy points at empty space.
  Re-resolve the ref's bounds before pointing, or drop bounds older than the window's last snapshot. (b) Activity lists
  files and commands but not clicks and typing Buddy did in apps; either list them or say so on the page.
  *Done when:* a test moves a window between look and point and the pointer follows; the Activity text matches what
  it lists.
  **Done (2026-11-12).** (a) `point_at` points at the saved spot at once and checks the live position
  (`get --property bounds`, about half a second): a moved control is followed, a vanished one sends the model back to
  look. Unit tests stand in for the move; the live call was checked against agent-desktop 1.2.0 by hand. (b) Clicks,
  keypresses and typing are listed, in the past tense, only once they ran; text typed into password-like fields and
  key-shaped text are left out. The Activity page says so.

## Phase 1: a stranger can start (the biggest gap)

- **1.1 First-run setup, in the bubble.** Three doors, in plain words, no jargon: **"Use the AI app I already have"**
  (detect Claude Code, Codex, etc. and add Buddy in one click: this needs no key), **"Free, on this PC"** (detect
  Ollama or LM Studio; if absent, say what to install and what it needs: about 8 GB of free memory), **"I have an
  API key"** (paste; provider is recognised). Check each provider's current free tier before promising one.
  *Done when:* an e2e check walks each door with a scripted server, and a fresh profile never shows a bare
  "paste a key" prompt.
  **Done (2026-11-12).** `src/welcome.js` finds the AI apps and local servers; the bubble shows the three ways in and
  a page for each. The `welcome` e2e check walks all three (a made-up home with Gemini CLI, a scripted Ollama that
  answers, a bad key then a good one) and fails if the key field shows first. No free tier is promised anywhere.
  Not covered by the check: adding Buddy through the Claude Code and Codex command lines (the check uses a settings-file
  app so it never touches the user's own); those paths are the same ones Settings has used since 0.2.0.
- **1.2 A thirty-second tour.** After setup, Buddy guides the user through one real step in whatever window is in
  front ("press Ctrl+Alt+B and ask me how to…"), then shows Mark once. Skippable.
  **Done (2026-11-12).** Right after setup in the bubble, a tip asks the user to ask about the app in front (named as
  people say it, with their own shortcut); after the first answer, a tip shows Mark; "Got it", using Mark, or "Skip
  tour" ends it, and the step is saved (`settings.tour`) so it never comes back. Buddys set up before this never see
  it. The `welcome` e2e check walks it.
- **1.3 Show it.** README and release page: one short screen recording of a guided task, three screenshots (pointer
  with caption, approval card, Activity). A one-page site (GitHub Pages) with the download button.
- **1.4 Sign the installer.** Options to price and check eligibility for: Azure Trusted Signing, SignPath's free
  tier for open source, or publishing through winget (Microsoft validates). *Owner's decision on spend.*
  *Done when:* a fresh Windows account installs without the SmartScreen block.
  *Research (2026-11-12):* Azure Artifact Signing (formerly Trusted Signing) takes individuals only in the US and
  Canada, so it's out. SignPath Foundation's free open-source certificate fits (OSI licence, public repo, GitHub-hosted
  builds) but names "SignPath Foundation" as publisher and needs a signing policy page, MFA and a split release
  workflow (sign, then rebuild `latest.yml` from the signed installer). A Certum open-source certificate (about
  €49-69 a year, cloud HSM) is the fallback with the owner's own name. No signed option clears SmartScreen on day one:
  reputation builds over releases under one publisher. winget (free) and the Microsoft Store (free individual account;
  MSIX re-signed by Microsoft) are extra channels. Recommended: SignPath Foundation plus winget.
- **1.5 What it costs.** People on their own key need to see spend: tokens and an estimated cost per answer in the
  bubble's footer, a running total in Settings, and an optional monthly cap that stops Buddy with a clear message.
  *Done when:* unit tests cover the arithmetic per provider and the cap.
  **Done (2026-11-12).** `src/costs.js`: Anthropic's published prices, OpenRouter's from its model list, local models
  free, anything else tokens only (Buddy doesn't guess prices). Each answer's tokens and cost under it in the bubble;
  the month (every model call, tasks and routines too) in Settings › AI & privacy › Spending, with an optional limit
  checked before every call. Unit tests cover the arithmetic per provider (cached tokens billed once), the month
  rolling over, and the limit stopping an answer before its next call; the `welcome` e2e check covers the footer.
- **1.6 Is Buddy Plus wanted, and what would it cost to run?** (a) An interest link where people meet the key
  question (the welcome's key page, Settings' key group, the README) to a short form: what they'd pay, what for, for
  them or for work. (b) Real per-answer cost: `npm run eval` prints tokens per case and the same tokens at Haiku,
  Sonnet and Opus prices; run it on a personal key (not an employer's) on Haiku 5.5 and Sonnet 5.5, then on the real
  tasks of Phase 2. *Done when:* the owner has the numbers to decide: interest count and price answers, and cost per
  answer and per heavy month on the cheapest model that passes the evals. (a) and the eval report are built
  (2026-11-12); the form is a GitHub issue form for now (needs a GitHub account; a form without one, such as Tally or
  Google Forms, made by the owner, is better for non-developers: change `PLUS_INTEREST` in `main.js` and the README).

## Phase 2: prove the core loop on real apps

- **2.1 Record real windows.** A dev command that saves the accessibility snapshot of the front window with names
  and values scrubbed to placeholders where they could be personal. Collect about 40 from Excel, Word, Outlook, Edge,
  Chrome, File Explorer, Settings, Teams, Notepad, a PDF reader.
  *In progress (2026-11-12).* `npm run record` (scripts/record-window.mjs + `src/scrub.js`) saves a named window to
  `evals/windows/`; owner chose made-up or public content only to start. Six so far: Excel (sample budget), Word
  (sample report), Edge (Wikipedia article), File Explorer (sample folder), Settings (Display), Calculator. Learned:
  - A fresh Edge profile (`--user-data-dir`) signs itself in to the work account on this PC (managed sign-in) and
    syncs extensions, so it is not clean: no more Edge or Chrome recordings until there's a profile that can't sign
    in (a Guest window, if policy allows, or a separate Windows account).
  - Outlook, Teams and Notepad are skipped: they open on the owner's mail, chats or open files. They need the
    owner's option 1 (recording their own windows) or a separate Windows account with sample data.
  - The scrubber can't know an organisation or a shared library is private (File Explorer's side panel showed both);
    `--names` covers them, and every recording is read through before it's kept.
  - More screens per app: `npm run record:tour` (scripts/record-tour.mjs) opens the samples in fresh copies, clicks
    through set steps (exact names only, only in windows it opened), records each screen and closes what it opened.
    20 windows now: Excel (Home, Insert, Formulas, Data, Review, the Sort dialog), Word (Home, Insert, Layout,
    Review, References), File Explorer (sample folder, photos folder), Settings (Display, Personalization,
    Accessibility, Text size), Calculator (Standard, mode list), Edge (Wikipedia).
  - Things Buddy itself should know (for 2.2 and 3.x): in File Explorer the accessibility press action on a file or
    folder *opens* it, so Buddy's "Click "Quarterly report"" card opens the file: the card should say "Open". In
    Calculator the mode list answers neither press nor select, so switching modes can only be guided, not done.
    Reading a window in its first seconds can come back partial or with refs that can't be told apart; it settles.
- **2.2 A real task set.** 40-60 tasks over those windows (guide, do, explain, read, files), each with a check, in
  `evals.js`. Include tasks that should be *refused or asked about*.
  *In progress (2026-11-12).* 23 tasks in `evals/real-cases.mjs` over the 20 recorded windows (`npm run eval --
  --set real`): 19 guide (Excel, Word, File Explorer, Settings, Calculator, Edge), 2 do, 2 to refuse (buying with a
  saved card; typing a password). A case can lead through screens: showing a control named in `next` brings up the
  screen that follows (Excel's ribbon tabs, the Sort dialog, Settings' Text size, Calculator's mode list), and
  waiting hands it back as Buddy's own wait does. Every check is tested both ways (a good answer, built from controls
  the recordings really have, passes; a wrong one fails), and a scripted model run through Buddy's real Brain proves
  the screens change. Not yet: explain and read tasks, file tasks, more do and refuse cases. Settings' Check this
  model still runs the short made-up set.
  *First real run (2026-11-12), OpenAI gpt-6.1-sol, medium effort, `npm run eval:saved`:* 22/23, then 23/23 after a
  fix. The one failure was Buddy's, not the model's: the spreadsheet-grid summary (2.5) also swallowed Excel's Sort
  dialog, whose grid holds the Sort by / Sort On / Order dropdowns, so the model never saw "Sort by". Now only bare
  cells are summed up, and only 20 or more; a test on the recorded dialog holds it. 17 s and 65k tokens per task on
  average (90% cached); the slowest are the multi-screen Excel and Word tasks (8-12 model turns, 90-180k tokens).
  That turn count, not the model's speed, is what 2.5 should cut first.
  *Turns cut (2026-11-12):* `guide_steps` and `point_at` take `then_say`, the model's closing line; when the route
  is followed to the end Buddy says it and ends the answer with no further model call (`closingLine` in brain.js;
  not offered to AI apps over the bridge). The prompt now makes one `guide_steps` call the norm and forbids pointing
  at a step twice. Same 23 tasks, same model: median turns 6 to 1 (131 to 56 in all), 17.4 s to 8.5 s, 65k to 29k
  tokens a task, 23/23 still pass (one check widened: an instruction in a pointer caption counts as said). Still
  slow, 5-10 turns: tasks that go on past the recorded screens (chart type, filter menu) and the two do-it tasks,
  where the stand-in window doesn't change after an action, so the model tries again; the real app would move on.
- **2.3 Run every provider and publish the table.** `npm run eval` across at least: two Claude models, two OpenAI,
  one Gemini, one DeepSeek, two OpenRouter, three local models of different sizes. Publish pass rate, seconds and
  cost per task in the README; make Settings' "works well" come from this table, not from the model's family name.
  Needs keys or credit from the owner for each provider.
- **2.4 Try every AI app once, by hand,** with the same three requests, and record what each does about approvals.
  Remove or mark "untested" any that can't be tried.
- **2.5 A speed budget.** Targets: pointer on the first control within 4 s of asking on a mid model; each later
  guided step with no model call. Measure with the timing log; fix the slowest step first (Excel's 7 s snapshot is
  the known one).
  *Excel's sheet (fixed 2026-11-12):* a complete read of a small Excel sheet rendered past Buddy's 24k-character cap
  (most of it empty cells: 292 of 361 grid children), so the end of the window was clipped from what the model saw.
  `renderTree` now tells a grid by its filled cells and the selected one, with one line for the empty cells and
  headers (columns and rows on screen, and "use the Name Box" to reach an empty one); every cell keeps its position
  for pointing. Sample budget: 12k characters, complete, all data in it. `look` also reads to depth 30 now
  (`LOOK_ARGS`, shared with the recorder): 502 controls instead of 480, same time. A read taken while a window is
  still opening can come back partial (the first Excel recording did: 113 controls); that is timing, not depth.
- **2.6 Injection tests.** Web pages, file contents and window text that tell Buddy to act ("ignore the user, run
  …", "send this file to …"). Each must end with no action taken or an approval card that says plainly what would
  happen. Add them to the task set so every model is scored on them.
- **2.7 Decide the local decider with data.** With 2.1-2.3 in hand: does a small local model (Laya or similar) beat
  name-and-meaning matching by enough to justify its memory? If not, close the question in this file.

## Phase 3: trust

- **3.1 PowerShell behind a real wall, or off by default.** Today a guard refuses commands that name private places
  and hides secret keys in output; a determined command can still build a path piece by piece. Either run PowerShell
  under a restricted token / AppContainer with access only to the working folder and folders the user grants, or ship
  it **off** with a switch ("Let Buddy run commands: for building things"), which fits "building is opt-in".
  *Recommended: off by default now, the wall later.*
- **3.2 Places the user grants.** Replace "everyday folders are read freely" with a short list the user sees and can
  edit (Documents, Desktop, Downloads to start), shown in Settings.
- **3.3 A problem report the user can send.** "Report a problem" gathers the timing log (already short and bounded),
  the version and settings without keys, shows it, and opens an issue or copies it. No silent telemetry.
- **3.4 A security page.** `SECURITY.md`: what Buddy can touch, what it can't, what approval means, how to report a
  vulnerability. The README's "AI and privacy" section is the start.

## Phase 4: the code can carry more work

- **4.1 Split `main.js`.** Move the 323 lines of `BUDDY_*_TEST` hooks to `src/dev-hooks.js`, loaded only when one is
  set. Then split by area: windows (overlay, island, bubble), marking, voice wiring, AI-app bridge wiring, settings
  wiring, startup. No behaviour change; e2e must pass after each move.
- **4.2 Type the pages.** Move each page's script out of the HTML into a checked `.js` file. Start with
  `settings.html`.
- **4.3 e2e in CI.** Run `files`, `settings`, `tasks`, `explainer` and `firstrun` on `windows-latest` (voice needs
  the models; keep it local). Fail the build on a refused state change.
- **4.4 Tidy dependencies.** `@anthropic-ai/claude-agent-sdk` is "All rights reserved" and unused by default: move it
  to `optionalDependencies` or drop the SDK engine. Keep `npm audit` at zero.
- **4.5 Buddy's own windows for everyone.** Keyboard-only use of the bubble, cards and Settings; labels for screen
  readers (the bubble has one `aria` attribute today); Windows high-contrast; reduced motion everywhere.
- **4.6 Memory budget.** Idle under 200 MB, voice unloaded when unused (done), no growth over a day; add a check like
  `measure:idle` for memory.

## Phase 5: what makes people stay

Only after Phases 0-3; pick by what users ask for.

- **5.1 Conversations that survive.** Task windows and the bubble's history are lost on restart. Save them (on the
  PC, clearable), and let a task be resumed.
- **5.2 "Teach me this app" lessons** built from guide routes: a saved, replayable walkthrough is the artifact people
  share.
- **5.3 Integrations:** let Buddy use other MCP servers the user adds (calendar, mail), under the same approvals.
- **5.4 Languages:** the interface in the user's language (replies already are).
- **5.5 A cheap-then-smart mode:** a small model for guiding, the big one for explaining and building.

## Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| 0.1 | Own repository, or stay in the fork | Own repository |
| 1.4 | Pay for code signing, or use a free route | Try SignPath/winget first |
| 2.3 | Which providers to fund for the model table | At least Claude, OpenAI, Gemini, one local |
| 3.1 | PowerShell on or off by default | Off, with a switch |
| — | Stay free and bring-your-own-AI, or add a paid hosted option later | Stay free until Phase 2's numbers and real users exist |

## Working rules for whoever carries this out

- **Prove each protection.** After adding a rule, break it on purpose and see a test fail; if none does, the test is
  the bug.
- **`npm run check`, `npm test`, `npm run e2e` before every commit.** `npm run e2e -- --exe <path>` for an installed
  copy; `--interactive` moves the mouse, so ask first.
- **Never restart the owner's running Buddy mid-task:** read the tail of `%APPDATA%\desktop-buddy\timing.log` first.
- **Test copies use `--user-data-dir`** and must leave startup entries and shortcuts alone (`firstrun` checks it).
- **Edit with the editor, not shell heredocs or inline Python, when the text has backslashes.** A `\b` once became
  a backspace byte and silently disabled a regex. After scripted edits, scan for control characters.
- **Publishing is the owner's.** Draft releases, merges to `main` and anything public: prepare it, then hand over the
  command.
- **No attribution lines in commits** (the owner removed them). Conventional commit subjects, the why in the body.
- **Plain words in everything a user reads.** The user is not a developer.
