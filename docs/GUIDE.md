# Using Desktop Buddy

Everything Buddy does, in detail. The short version is in the [README](../README.md); building and releasing Buddy
is in [DEVELOPING.md](DEVELOPING.md).

## What Buddy does

Press **Ctrl+Alt+B** anywhere and ask a question about the app in front of you, or use the island at the
top of the screen. Buddy thinks with the AI you choose: Claude, GPT, Gemini, DeepSeek, any model through OpenRouter,
a free model on your own PC (Ollama, LM Studio), or the AI app you already use (Claude Code, Codex, Gemini CLI, Cursor,
VS Code and more).

- **Any AI:** see [AI and privacy](#ai-and-privacy) below.

- **Read the page:** ask Buddy to explain, summarize or answer from a web page, article, email or document and it
  reads the whole text in reading order (headings, paragraphs, lists, tables), including parts scrolled out of view,
  and knows which part is on screen right now. Long or slow pages take a few seconds ("Reading the page…").
- **Guide mode (default):** Buddy reads the app through its accessibility tree, flies its pointer to the
  control you need and labels it, one step at a time. You do the clicking.
- **Draw on the screen:** Buddy can highlight or circle controls, connect them with an arrow, add short labels,
  and show a drag path between two controls. Guide routes use numbered highlights; a step can use a circle or drag
  path when that explains it better. In a spoken conversation the instruction is read as its drawing appears.
  These drawings never click or drag for you. Each task owns its own batch; Stop clears that conversation's drawings.
  Drawings also clear when the window loses focus, moves or closes, or an anchor changes position, and stop polling
  when cleared. Completed answers leave their drawing for six seconds; a live batch expires after one minute.
  If what you asked about has no control Buddy can name (a drawing canvas, a scanned PDF, a remote desktop, a game),
  a model that can see the screenshot points at a spot on it instead. Buddy shows that as a best guess, a soft dashed
  ring and "about here", and lets it go as soon as the window moves, changes size or loses focus, or after ten
  seconds. A spot is only ever shown: Buddy never clicks or types on a guessed place, even when you ask it to do
  something for you.
- **Visual context:** when you ask, a model known to support images receives a fresh screenshot of the requested
  window alongside its control names and refs. This helps with charts, canvases and layouts. The two sources are
  prepared together with a four-second deadline; if either fails, Buddy uses the other. Automatic context skips
  minimized windows, Buddy's own windows and apps on **Never act in**, and never falls back to capturing a whole
  display. Settings › AI & privacy › **Window screenshots** turns window screenshots off immediately; Mark and
  Explain still send the area you explicitly choose. Text-only and unverified models start from text.
- **Mark:** press **Ctrl+Alt+M** (or **Mark** on the island). The screen becomes a still with a blue frame.
  Esc also cancels while the screen is being prepared. Preparation and image loading have a ten-second deadline.
  Completed marks stay on a separate canvas while the pen draws, avoiding repeated redraws as marks accumulate.
  Long strokes keep following the pen; a cancelled stroke is discarded.
  - **Click** something to explain it right away.
  - **Draw** over one or more things with the highlighter; each stroke gets a number. Press Enter and ask about
    them ("compare 1 and 2", "what does 1 do?"), or tap **Explain these**. Buddy sees the area with your strokes
    plus what's under each one, and can point back at a mark. **Ctrl+Z**, Backspace or a right-click undoes the last
    stroke; Esc cancels.
  - Shortcut: hover over anything and press **Ctrl+Alt+E** to explain it without entering mark mode.
- **Explain plates:** an explanation opens as a **field-guide plate**: the subject drawn as a specimen
  with hand-lettered labels and numbered Buddy-blue arrows, its field marks, where you'll meet it, how it behaves,
  what it's easily confused with, and a field note tied to what's on your screen. The design system is recorded in
  [DESIGN.md](../DESIGN.md); preview it without the model via `BUDDY_EXPLAINER_TEST=scripts/samples/vlookup.json npm start`
  (add `BUDDY_THEME=dark` for dark mode).
  When an idea unfolds over time (a process, a flow, cause and effect), Claude can open the plate with a short
  **motion sequence**: animated scenes with narration and a play/pause, scene-by-scene player. It decides per
  explainer whether motion helps. Preview: `BUDDY_EXPLAINER_TEST=scripts/samples/vlookup-motion.json npm start`.
- **Island:** a pill at the top center that stays on screen whenever Buddy is running, so it doubles as the "on"
  light. A dim dot means idle, a bright dot means active; **Ctrl+Alt+B** switches between them. It also shows
  what Buddy is doing (looking, drawing, waiting for your OK).
  Hover it for **Ask**, **Talk**, **Mark** and **Task**. A new Buddy starts with the essentials (Ask, Talk and
  Mark); task windows, routines and working with files, web pages and Word documents come with Settings › Agents ›
  **Show advanced features**.
- **Voice:** hold **Ctrl+Alt+B** (or **Ctrl+Alt+T**), say what you need, and let go. A quick press of Ctrl+Alt+B
  still opens the bubble to type; a quick press of Ctrl+Alt+T (or the mic in the bubble, or **Talk** on the island)
  listens until you pause. To see when you let go, Buddy watches the keyboard only while the key is down, never
  otherwise; Settings › Shortcuts › Hold to talk turns this off. Buddy shows what it heard, and answers out loud: its reply and,
  while guiding, each step as it points. Press the key again or click the island to cut it off; Esc cancels.
  Everything runs on this PC: Moonshine (base, English) for listening and Supertonic 3 for talking, through
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) on the CPU. Once setup is done, Buddy offers to download about 275 MB of models (or does it the first time you talk) into
  `%APPDATA%/desktop-buddy/models`, each file checked against a pinned SHA-256 (see `src/models.js`); after that
  nothing leaves the machine. The models load when you start talking and unload after 10 idle minutes (about 520 MB
  while loaded). Measured on a Core Ultra 5 laptop on battery: about 0.4 s to understand a sentence and 1.6 s before
  Buddy starts speaking a short one.
  **Talk back** in Settings chooses when Buddy speaks: when you spoke (default), always, or never.
- **Replies arrive as Buddy thinks:** answers appear progressively in the bubble and task windows. Spoken replies
  start with complete sentences while the rest is still arriving. Tools still wait for complete arguments and
  approvals. This uses Buddy's default engine; the optional SDK engine keeps its existing reply behavior.
- **Change direction:** while the bubble is answering or guiding, type a follow-up and press **Send**, or press
  **Ctrl+Alt+T** to interrupt and ask out loud. Buddy stops the old answer and clears its pending approvals before
  starting the correction, keeping the conversation. **Stop** or Esc cancels without starting another question.
- **Task windows:** hover the island and click **Task** (or **Make task** in the bubble to move the current
  conversation) to give a job its own agent and window. Tasks work side by side while you keep using your computer;
  each shows the steps it takes and asks for approval in its own window. **–** tucks a task into a numbered chip on
  the island (its dot shows working, needs your OK, or finished). **Hover a chip** for a live preview of that task's
  window with its latest line, and answer an approval (**Allow** / **Don't**) right there; click the chip or the
  preview to bring the window back. **×** closes the task, stops its agent and forgets it. Tasks you haven't closed come
  back as chips after Buddy restarts (for a week), and a follow-up picks up where the conversation left off; the bubble
  does too if Buddy restarts within a few minutes. Anything that clicks or types takes
  turns, so two tasks never fight over the mouse. Up to six at once; tasks don't survive a restart.
- **Dictation:** press **Ctrl+Alt+D** in any app and talk; Buddy types what you say where your cursor is (through
  the clipboard and one paste, then puts back what you had copied). It stops when you pause, or, if you choose, keeps
  going through pauses until you press the key again. It runs on this PC and needs no API key.
- **Any language:** set listening to **Detect automatically** and Buddy understands about 99 languages (multilingual
  Whisper, a 160 MB download the first time) and answers, out loud too, in the language you spoke.
- **Agents tab:** choose how much Buddy's agents (tasks, routines, "do it for me") may do without asking: nothing, safe
  moves (scrolling, expanding, moving windows), or anything in apps you trust. Apps on the **Never act in** list
  (password managers to start with) are off limits even if you'd approve. This is enforced where actions get their
  permission slip (`src/policy.js`, `src/approvals.js`), not just in the prompt.
- **Lessons:** when Buddy has walked you all the way through something, **Save as a lesson** under its answer keeps
  the steps. Play one from the tray (**Play a lesson**) or **Settings › Lessons**, in the app it's for: Buddy points at
  each step and follows you, as it did the first time, without asking the AI, so it costs nothing and needs no key.
  A lesson only points; it never clicks or types. If the app looks different and a step's control isn't there, the
  lesson says which step and stops, and you can ask Buddy to finish from there. **Share…** saves a lesson as a file;
  **Import a lesson…** takes one someone shared, checked to be only steps and words.
- **Routines:** tasks on a schedule ("weekdays at 9:00, summarise my unread email"), each in its own task window tucked
  into the island, under the Agents rules. A run missed by less than six hours (the PC was asleep) still happens once.
- **Word documents:** ask for a report, summary or memo "in Word" and Buddy writes a real `.docx` (title, headings,
  lists, tables, bold and italic), saves it in **Documents › Buddy** without overwriting anything, and opens it in
  Word. One approval, no typing into Word.
- **Do mode:** say "do it for me" and Buddy operates the app. It asks before every action
  (Allow, Allow for this task, Don't), and it points at the target while it asks. "Allow for this task" covers more of
  the same kind only: screen actions, file changes, PowerShell, and each website, separately.
- **Beyond the screen:** Buddy can list, read, write and edit your files and read web pages, with every model, when
  that's the quickest way to get something done (making a list or a budget sheet, looking something up). It works in
  **Documents › Buddy** unless you name another place, and a file it makes opens when the answer is done. It reads
  the folders listed in Settings › Agents › **Folders Buddy reads without asking** (Documents, Desktop and Downloads
  to start; add or remove any) without asking; anything else, and every change, asks first. A drive, your whole
  user folder, AppData and other people's folders can't be added. Passwords and keys, browser
  profiles, the AI apps' settings and Buddy's own data are off limits to the file tools whatever is asked, and
  anything shaped like a secret key is hidden from the model.
- **Running commands is off until you turn it on** (Settings › Agents › **Let Buddy run commands**). On, Buddy can
  run PowerShell for bigger jobs (renaming many photos, tidying a folder, converting, building things), asking
  before each command. Commands that name private places are refused, but PowerShell runs as you, so that narrows
  what a command can reach rather than walling it off, and Buddy can't undo what a command does. Off, Buddy says
  when a job needs it and how to turn it on.
- **Activity and undo:** Settings › **Activity** (or **Recent changes…** in the tray) lists what Buddy made or changed
  this past week, commands it ran and pages it read. **Undo** sends a file it made to the Recycle Bin or puts a
  changed one back (the old version is kept for a week); a file you changed since is only put back if you say so again.
- **Guiding a whole route:** the model can hand Buddy every step at once (`guide_steps`); Buddy points at each in turn,
  follows you when you work ahead, and matches controls by meaning when the app words them differently.
  The default engine keeps everyday guidance instructions small and loads illustrated explanations when needed.
  It also includes hints for Excel, Word, browsers, File Explorer and Windows Settings, checked against your current screen.
  Follow-ups replace the previous automatic window snapshot with the current observation, keeping your questions,
  Buddy's replies and images you explicitly supplied through Mark or Explain.

## Install

Download `Desktop-Buddy-Setup-<version>.exe` from the repository's
[Releases](https://github.com/donlapidos/desktop-buddy/releases) and run it. It installs for your Windows account only
(no administrator prompt), adds **Desktop Buddy** to the Start menu and the desktop, and can be removed from
Settings › Apps like any other app; your settings, key and voice models stay in `%APPDATA%\desktop-buddy`.

The installer isn't code-signed (that needs a paid certificate), so Windows SmartScreen may say it "protected your PC"
the first time: choose **More info › Run anyway**. Each release lists the installer's SHA-512 in `latest.yml`.

Buddy keeps itself up to date: it checks the releases now and then, downloads a newer version in the background
(checked against its SHA-512), and installs it when you restart Buddy or choose **Restart to update** in the tray or
in Settings › About & updates, where automatic checks can also be turned off.

### Buddy Plus (an idea)

Buddy needs an AI to think with: the AI app you already use, a free model on your PC, or an API key. **Buddy Plus**
would be the fourth way: the AI included, nothing to set up, one monthly price. It isn't built yet. If you'd want it,
[say so here](https://github.com/donlapidos/desktop-buddy/issues/new?template=buddy-plus.yml); it takes a minute.
Buddy itself stays free and open source either way.

## Settings

Open **Settings** from the tray, the sliders icon on the island, or the bubble. Every change applies at once, and
**Request a feature** in its sidebar opens a pre-filled GitHub issue for you to edit and send.

- **Voice & speech:** pick one of ten voices (choosing one plays it), speaking speed, and talk back.
- **Dictation:** when to stop (at a pause, or when you press the key again) and the listening language (English, or
  detect automatically).
- **Agents** and **Routines:** see above.
- **Look:** Buddy's accent colour (pointer, island, chat, task windows and marks) and light or dark explainer plates.
- **Shortcuts:** click one and press new keys. A shortcut another app already owns, or another Buddy action uses, is
  refused with the reason; while you record one, Buddy lets go of its own so pressing them is recorded.
- **AI & privacy:** the provider, its key or address, the model (each marked "works well", "can't see images" or
  "can't use tools", with its last check score) and thinking effort for new conversations, **Use with your AI app**,
  start with Windows, and clearing saved explainers or the timing log.
- **Activity:** see above.
- **About & updates:** the version, updates, and **Report a problem** (also in the tray menu): Buddy puts together
  its version, your settings without keys, addresses or routines, and the end of its timing log, with anything that
  looks like a key or a file in your folder taken out. You read all of it first; it is sent only if you press **Open
  a GitHub issue** (which opens GitHub in your browser, where you submit it yourself) or **Copy**.

Settings live in `%APPDATA%/desktop-buddy/settings.json`. Every value is checked when it is read and written, and the
file is replaced in one step; a damaged file is set aside as `settings.json.bad` and Buddy carries on with defaults.

## AI and privacy

Buddy has no server and no account of its own. What leaves your PC depends on how Buddy thinks:

- **A provider on your API key** (Anthropic, OpenAI, OpenRouter, Gemini, DeepSeek): your question, the text of the
  window you're asking about, and screenshots when the model can see images go to that provider, under your account
  and its terms. OpenAI is asked not to store them (`store: false`). Nothing goes to any other provider.
- **Automatic window pictures:** in Buddy's default engine, each question can include a fresh picture of that
  window. It is resized in memory to at most 1,600 pixels on its longest edge and sent as JPEG. Earlier automatic
  pictures are removed from later questions; the image data is not written to Buddy's timing log. Turn off
  **Window screenshots** in AI & privacy to use window text instead and block screenshot-tool requests, including
  requests through connected AI apps. Mark and Explain still use images you explicitly choose. The optional SDK
  engine keeps its existing context behavior.
- **A model on your PC** (Ollama, LM Studio): nothing leaves the PC.
- **Another server:** goes to that address only. Plain `http://` is allowed only on this PC or your local network,
  and its key is tied to the address it was entered for: change the address to another host and the key isn't sent.
- **Your AI app** (Claude Code, Codex, …): that app does the thinking under its own terms; Buddy only gives it the
  window's text, screenshots and pointing when it asks. Buddy's look-and-point tools run without a prompt there; acting
  still asks on Buddy's card.
- **Web pages** Buddy reads are fetched from your PC, after you allow each site. Addresses on your PC or network are
  never fetched.
- **Voice** runs on your PC; the models are downloaded once from pinned commits and checked.
- **Updates** are checked against this repository's GitHub releases.

Keys are stored encrypted with Windows (DPAPI), one per provider, and only ever sent to their provider; Settings never
sees them. PowerShell runs without them in its environment, and anything shaped like a secret key in what Buddy reads
is hidden from the model. The timing log (`%APPDATA%\desktop-buddy\timing.log`, about 10 MB at most, text cut short)
and Activity stay on your PC. So do your conversations (`conversations.json`), kept so they carry on after a restart:
your questions and Buddy's replies in words only (no screenshots or window contents, secret keys hidden), the bubble's
for 15 minutes and each task's until you close it or for a week. **Settings › AI & privacy › Conversations › Forget**
clears them.
