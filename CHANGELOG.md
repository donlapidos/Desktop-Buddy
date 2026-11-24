# Desktop Buddy changelog

## Unreleased

* **See Buddy in action before setting anything up:** the welcome's first choice opens Calculator and guides you to
  Scientific mode, pointing at each step while you click: a lesson that comes with Buddy, so it needs no AI, no key
  and sends nothing. Offered when Windows is in English (Calculator names its buttons in Windows' language).

## 0.6.1 (2026-11-24)

* **Fixed:**
  * Taking meeting notes through a Bluetooth headset's microphone: Windows puts the headset in its call mode, which
    sends rougher sound, and your words came out worse with nothing to say why. Buddy now says so, once, and that your
    PC's own microphone gives a cleaner transcript.
  * Plugging in or removing a screen, docking, or changing the scale while marking no longer asks about the wrong
    spot: marking ends and says so, and Mark starts afresh on the screen as it is now.

## 0.6.0 (2026-11-24)

* **Meeting notes, in any meeting app:** say "take notes" (or use the tray menu) in Teams, Zoom, Meet or anything
  else. Buddy transcribes your microphone and your PC's sound on your PC, lets you ask about the meeting as it goes,
  and when you stop, saves a Word document with notes written by your AI (summary, decisions, action items) and the
  whole transcript. Only text is kept; the island shows when notes are on.
* **Connect HubSpot:** Buddy can look up and update your HubSpot contacts, companies, deals, tickets and notes, and
  read marketing reports, asking on its card before each action. HubSpot only lets in apps a company sets up for
  itself, so someone sets up a connector in HubSpot once and pastes its two codes into Settings › Connections; then
  everyone signs in as themselves.
* **Approval cards show everything:** every character Buddy would type, with each line break marked ⏎ (in a console
  a line break presses Enter), the whole PowerShell command, and everything a connected service would be sent, in a
  box beneath the card's summary. Before, the card squashed line breaks and cut long text and service data short.
  Keys and window moves go only to the window that was checked, under its real app; a blocked app stays blocked
  however its name is spelled ("KeePassXC", a full path); "Allow for this task" for a service covers that one tool;
  and a click meant for a card that has just been replaced doesn't answer the new one.
* **Fixed:**
  * Holding the Talk key while Buddy was busy could make the next Talk stop listening the moment it started. Each
    press now only holds or ends the listening it started.
  * Meeting notes keep going when the sound does something unexpected: an unplugged or switching headset is picked up
    again, a newly plugged-in microphone is followed, and Buddy's hidden listening page is reopened if it crashes.
    Before, notes stayed "on" while hearing nothing. A side that stays silent is now said, and when Buddy can't hear
    anything at all it writes up what it heard.
  * Reading a web page can no longer reach your PC or local network through a web name that changes what it points
    to between Buddy's check and the visit: the address checked is the one connected to.
  * An AI server's address can use plain http only when it really is on your PC or local network; a web name that
    merely starts like one ("10.example.com") needs https, like any other.
  * A spoken answer that used a tool stopped mid-sentence when Buddy took its next step.
  * Hush now also silences the spoken steps of a guided answer.
  * Buddy no longer speaks while its microphone is open, and the voice preview in Settings stays quiet during a
    meeting.
  * An approval card from an AI app no longer disappears when an answer in the chat ends.
  * Meeting notes can't get stuck "on" when they fail to start, and stopping while they start works.
  * A damaged settings file no longer starts the voice download without asking.
  * Buddy can't be left listening forever: if its hidden voice page crashes or can't use the microphone, listening
    ends at once, and a cancelled recording's late result can't end the next one.
  * Connections say what's true: a service that signed you out shows **Sign in again** instead of "Connected" (and
    stops being offered to the AI), one that can't be reached shows **Try again**, and signing in twice at once,
    cancelling mid-sign-in or a failed reconnect can no longer leave a stale connection behind.
  * Buddy no longer writes over a file you changed while its approval card was open, and doesn't replace one that
    appeared meanwhile.
  * Trying a mistyped API key no longer makes a working provider look broken in Settings.
  * An AI app's "Allow for this task" no longer lapses in the middle of a long task (waiting for you, a guided route).
  * Undoing copied files moves exactly those copies to the Recycle Bin (it said it had, but left them), and leaves the
    folder's other files alone.
  * The chat, task windows and Settings no longer get stuck busy when something fails on Buddy's side.

## 0.5.1 (2026-11-20)

Buddy talks without pausing between sentences, and nothing is compiled on your PC any more.

* **Buddy talks without pauses between sentences:** the next sentence of a spoken answer is made ready while the one
  before is still playing, instead of after it ends (that left about a second of silence between sentences). The
  first words also come sooner: a first sentence is spoken from its first comma.
* **Nothing is compiled on your PC any more:** Mark's overlay and the launcher that keeps commands in their sandbox
  now come built with the installer. 0.5.0 compiled the overlay the first time you marked, which security software
  such as SentinelOne flags as suspicious; this version removes that copy.

## 0.5.0 (2026-11-19)

Mark now draws on your live screen, with no wait and no frozen picture. Buddy can build things in Blender while
you watch. And a ⌃ button folds the chat back into the island.

* **Mark draws on your live screen:** press Ctrl+Alt+M and draw straight away, over your apps as they keep running,
  instead of on a frozen picture that took a moment to appear. The strokes go into the picture Buddy sees when you ask.
  Built with a small Windows-native overlay that Buddy compiles on first use; if that can't start, Mark draws on a still
  as before.
* **Build in Blender:** ask Buddy to build something and it appears in your open Blender scene, part by part, with
  colours, lights and the camera, while you watch. Needs Blender 5.1+ with Blender Lab's free MCP add-on; Buddy can
  open Blender for you. Building asks once, every change is one Ctrl+Z, and deleting asks every time.
* **Close the chat:** a **⌃** button at the top right of the chat folds it back into the island. Anything Buddy is
  doing carries on, and the chat comes back by itself when it needs your OK.

## 0.4.0 (2026-11-19)

Buddy can now draw on your screen (circles, arrows, labels, drag paths) to show you what goes where.
Answers appear as Buddy writes them, and you can change your question halfway through, by typing or by talking.
Buddy sees a fresh picture of the window you ask about, and Mark opens and draws faster.
Hold one key to talk, and Buddy points sooner, even in apps with nothing it can name.
Buddy can now use Notion, Linear, and Jira and Confluence for you, keep your conversations across a restart, play
back what it taught you as a lesson, speak Spanish, and run commands walled off from the rest of your PC.
Right after setup, Show me has Buddy point at something in the app you were using, and with GPT it now points in
apps with nothing it can name.

* **Show me:** the first tip after setup has a **Show me** button. Buddy points at one thing in the app you were
  using and says what it's for, so you see what the pointer does before you think of a question.
* **Pointing by sight works with GPT:** in apps with nothing Buddy can name (a drawing canvas, a design tool's
  icons, a 3D view, a scanned PDF), GPT models now point at the spot instead of only describing where it is, and
  sooner. Window pictures go at a size the AI doesn't shrink again, so the spot lands where the model meant.
* **Commands are walled off.** With Settings › Agents › Let Buddy run commands on, each PowerShell command now runs in
  a Windows sandbox that reaches only Documents › Buddy and has no internet. To work on your files elsewhere, Buddy
  copies them in first (asking you), so a command never changes your originals. Nothing to set up.
* **Connections:** Buddy can use Notion, Linear, and Jira and Confluence for you, with your own account. On one of
  their sites the bubble offers to connect; you sign in in your browser (Buddy never sees your password). Buddy asks
  before every action in a service. Settings › Connections lists them. Comes with the advanced features.
* **Spend less on everyday questions:** Settings › AI & privacy › Quick model for everyday questions lets a smaller,
  cheaper model (Haiku, say) answer in the bubble. Your main model still makes illustrated explanations, task windows
  and routines, and takes over when the quick one can't do something. Off unless you choose one.
* **Buddy in Spanish:** Buddy's windows follow Windows' language, or the one chosen in Settings › Look › Language.
  Spanish is the first translation, across every window: the bubble and first-run setup, the island, task windows,
  the marker, Settings, approval cards and Activity, the tour, and what Buddy says when the AI can't be reached.
  Buddy already answered in the language you ask in.
* **Lessons:** when Buddy has walked you through something, keep it as a lesson. Play it again from the tray or
  Settings › Lessons: Buddy points at each step and follows you, without asking the AI, so it's free. Share a lesson as
  a file, and import ones others share. A lesson only points; it never clicks or types.
* **Conversations carry on after a restart.** Task windows you haven't closed come back as chips on the island, and
  a follow-up picks up where you left off; the bubble does too if Buddy restarts within a few minutes. Only the words
  are kept, on your PC (no screenshots, secret keys hidden). Closing a task forgets it, and Settings › AI & privacy ›
  Conversations › Forget clears them all.
* **Settings › Look › Explainer appearance** shows a sample plate in the look you pick, so you can see the choice
  take effect (it changes Buddy's illustrated explanations; Buddy's own windows stay dark). Every control in Settings
  is now checked automatically, clicked the way you would.
* **Reading a web page asks every time**, showing its whole address, even after "Allow for this task". An address can
  carry what Buddy has read to whoever runs the site, so a page can't have Buddy quietly send it your file names or
  email. Sending an email asks every time too.
* Connection problems (signing in to a service) are explained in Spanish too.
* **Hold to talk:** hold Ctrl+Alt+B (or Ctrl+Alt+T), say your question, and let go; a quick press works as before.
  Buddy watches the keyboard only while the key is down. Settings › Shortcuts › Hold to talk turns it off.
* **Voice at setup:** a new Buddy offers its 275 MB voice download once setup is done, instead of starting it
  unasked.
* **Faster pointing:** the window read taken when the bubble opens is used for your question instead of reading the
  window again, a guided route starts from that read, and the first step is shown while the AI is still writing the
  rest.
* **Pointing by sight:** where an app has no control Buddy can name (a drawing canvas, a scanned PDF, a remote
  desktop), an AI that can see points at a spot on the screenshot, shown as a soft "about here" ring. Buddy never
  clicks or types on a guessed spot.
* **The essentials first:** a new Buddy starts with Ask, Talk and Mark. Task windows, routines, and working with files,
  web pages and Word documents come with Settings › Agents › Show advanced features (on for existing users).
* **Report a problem** (tray, and Settings › About): shows you the whole report, without keys or your files' paths,
  before anything is sent.
* **Folders Buddy reads without asking** (Settings › Agents): Documents, Desktop and Downloads to start, and you
  choose the rest. Pictures, Music, Videos and OneDrive folders now ask first unless you add them. A drive, your whole
  user folder, AppData and other people's folders can't be added.
* **For keyboards, screen readers and high contrast:** every button and box in Buddy's windows has a name a screen
  reader says, answers are read out once they're complete, an approval card takes the keyboard itself (so a stray
  Enter can't approve), and Buddy's windows follow Windows high contrast and reduced motion.
* A [security page](SECURITY.md): what Buddy can and can't touch, what your approval means, the limits we know about,
  and how to report a security problem privately.
* "Works well" beside a model now means it passed Buddy's own checks, not just that it can use tools and see images.
* Each guided question records how long it took to put the pointer up (`npm run measure:latency`).

### Under the hood

* Mark prepares its hidden drawing window and captures the screen in parallel. Esc can cancel preparation, and a
  ten-second deadline also covers waiting for the image to load.
* Late captures and retired windows cannot cancel or reopen a newer Mark session. Overlapping captures keep
  Buddy's own overlay hidden until the active captures finish; startup phase timings are recorded without image content.
  If the requested display is unavailable, capture stops instead of using another monitor.

* Mark keeps completed strokes on their own drawing layer, so moving the pen no longer repaints every older mark.
  Long strokes keep following the pen when their point budget fills; empty coalesced events still draw correctly.
* Cancelled pointer strokes are discarded, another pointer cannot interrupt an active stroke, and pointer-up keeps
  the exact endpoint. A generated-screen app check verifies drawing, Undo and image composition at standard and high DPI.

* Everyday guidance uses shorter instructions. Follow-ups drop the previous automatic window snapshot while
  retaining the user's requests, Buddy's replies and explicitly chosen Mark or Explain images.
* Saved-key benchmarks correctly unwrap Electron's async decrypt result, support legacy ciphertext and carry only
  OS-encrypted key metadata into the isolated runtime. Saved keys are never rewritten by the benchmark.

* Workflow checks recognise smart apostrophes in recovery replies. Saved runs can be rescored without another
  model call, while preserving the original evidence and execution failures.
* The saved-key benchmark runner uses a separate runtime profile, avoiding cache contention with an active Buddy.

* A six-workflow model check replays recorded Excel and Edge windows, including corrections, tab changes, missing
  buttons and unverified progress. It rejects stale refs and absent or ambiguous guide targets, and reports timing
  for each request. List it with `npm run eval -- --set workflows --list`; running a model uses its API account.
* Model checks no longer count one control as two ordered steps, or treat a failed model request as a passing
  no-action case. Unknown case IDs and set names stop before a model call.

* Everyday guidance in the default engine uses a smaller prompt. Illustrated-explanation instructions and tools
  load on demand; the Explain shortcut starts with them ready.
* Guidance includes app-specific hints for Excel, Word, browsers, File Explorer and Windows Settings, and gives
  corrections precedence over the previous route. These hints still require checking the user's actual screen.

* Buddy can draw highlights, circles, arrows, labels and drag paths on your screen, anchored to current controls.
  Guides use numbered highlights and can choose a different drawing for each step; spoken instructions accompany them.
* Drawings belong to their conversation and clear on interruption, focus or window changes, and anchor movement.
  A cancelled pointer flight can no longer bring its caption back after Stop.
* A guide with an explicit expected result no longer treats an unrelated selection or layout change as completion;
  it hands the current window back to the model to inspect.

* Buddy's default engine starts each question with a fresh window picture and its accessibility text, when the
  model is known to support images. Reading and capture run together, stop on cancellation, and fall back independently.
* Window screenshots can be turned off in AI & privacy. Automatic captures stay within the requested window,
  skip blocked apps, and are resized before sending; earlier automatic pictures are omitted from later questions.

* Replies stream into the bubble and task windows. Spoken replies begin with complete sentences before the whole
  answer finishes, without reading the final answer twice.
* Change direction mid-answer in the bubble: type a follow-up or use Talk. The previous answer stops before the
  next starts; pending speech, approvals and queued desktop actions are cancelled with it.

* **Running commands is now off until you turn it on** (Settings › Agents › Let Buddy run commands). It's the one
  thing Buddy does that it can't undo or fully fence in. If you used Buddy for jobs like renaming many files, turn
  it on there; until then Buddy tells you when a job needs it. Files, apps and web pages work as before.

## 0.3.0

Getting started without an API key, seeing what Buddy costs, and reading Excel properly.

* A new Buddy offers three ways in instead of asking for an API key: use the AI app you already have (Buddy adds
  itself in one click, no key needed), a free model on this PC (Ollama or LM Studio, found if running, with what it
  needs in memory if not), or an API key. A key that matches no provider now says what keys look like.
* Right after setup, a short tour: ask Buddy about the app you're in, then a tip for Mark. Skippable, shown once.
* What it costs: each answer shows its tokens and an estimated cost (Anthropic and OpenRouter prices; free for a
  model on this PC), Settings › AI & privacy shows the month so far, and an optional monthly limit stops Buddy when
  it's reached.
* Guidance is about twice as fast. The AI now hands Buddy the whole route together with its closing line, and Buddy
  finishes the answer itself once you've done the steps, instead of going back to the AI. On 23 real tasks: 8.5
  seconds a task instead of 17, and less than half the tokens.
* Buddy sees the whole Excel sheet: empty cells are summed up in one line instead of crowding out the rest of the
  window, so the filled cells, the Name Box and the formula bar all reach the AI. Dialogs such as Sort are read in
  full.
* Approval cards for files and folders in File Explorer (and Open and Save dialogs) say **Open**, not Click, since
  that's what clicking one does; Activity says "Opened".
* A link to say you'd want **Buddy Plus**, the AI included for a monthly price (not built yet), on the API key page
  and in Settings.

## 0.2.1

* Buddy has its own repository, [donlapidos/desktop-buddy](https://github.com/donlapidos/desktop-buddy), and its own
  releases. It uses the agent-desktop CLI as a pinned, checksum-verified release (1.2.0) instead of building it.
  Settings › Request a feature and About › Releases open the new repository.
* Pointing follows the control: if the window moved or scrolled since Buddy read it, the pointer goes to where the
  control is now, and if it's gone Buddy looks again instead of pointing at empty space.
* Activity also lists what Buddy clicked, pressed and typed in your apps. Text typed into password fields isn't kept.

## 0.2.0

### Any AI, not only Claude

* **Choose who Buddy thinks with** in Settings › AI & privacy: Anthropic, OpenAI, OpenRouter, Google Gemini or
  DeepSeek on your own API key; **Ollama** or **LM Studio** for free, private models on your PC; or any other
  OpenAI-compatible server at an address you give. Each provider keeps its own key, so switching back loses nothing,
  and a key pasted into the bubble is recognised and saved for its provider.
* OpenAI goes through its Responses API, where its newest models reason and use tools together; the rest go through
  Chat Completions. Model lists come from each provider for your key, so new models appear without an update.
* **Buddy knows what each model can do** (use tools, see images), from the provider, the model family or a refusal,
  and works within it: a model that can't see images works from the window's text; one that can't use tools is
  named as such instead of failing oddly. Settings marks each model "works well", "can't see images" or "can't use
  tools".
* **Check this model** runs seven real Buddy tasks on the chosen model and scores it; `npm run eval` does the same
  from the command line.

### Use Buddy from the AI app you already have

* **Use with your AI app** (was Use with Claude) adds Buddy to Claude Code, the Claude app, **Codex** (ChatGPT plan),
  Gemini CLI, Cursor, VS Code (Copilot), Windsurf and LM Studio, so you can use Buddy on the plan you already pay for
  with no key in Buddy. Buddy starts itself when one of them needs it, and repairs their settings when it moves.
* **Quick chat in Claude Code** (tray) opens Claude Code with only Buddy's tools: about 4× faster per turn.
* The island says which app is using Buddy ("Codex: Looking…").

### Beyond the screen

* Buddy can work with your files (list, read, write, edit), run PowerShell and read web pages, with every model.
* **Activity** (Settings, or Recent changes… in the tray) lists what Buddy made or changed this week; **Undo** sends
  a file it made to the Recycle Bin or puts a changed one back.
* A file Buddy made opens when the answer finishes.

### Guiding

* `guide_steps`: the model plans the whole route once and Buddy follows it on its own, moving on when you work ahead.
* Steps are matched by meaning when the app words them differently ("Sort Largest to Smallest" is "Sort Z to A").

### Safety

* "Allow for this task" covers more of the same kind only: screen actions, file changes, PowerShell, and each website
  separately.
* Some places are off limits to the file tools whatever is asked: passwords and keys, browser profiles, the AI apps'
  settings, Buddy's own data. PowerShell commands that name them are refused, and anything shaped like a secret key
  is hidden from the model.
* Keypresses go to one named window, and that window is what your Agents rules judge.
* A key for "Other server" goes only to the address it was saved for.
* Approval requests from Buddy and from AI apps queue on the card instead of replacing each other, and a cancelled one
  is withdrawn. Only the bubble can answer its card, and never in its first half second.

### Fixes

* The island said "Listening" with the microphone off; it now says "Ready". What it shows is worked out in one place.
* One odd refusal no longer marks a model as unable to use tools or images for good.
* The timing log stays under about 10 MB and keeps text short.
* After an approval, the keyboard goes back to your app even when the bubble had just been closed and reopened.
* A test copy of Buddy no longer turns on start with Windows for itself.

### Under the hood

* `npm run e2e` runs the real app end to end in separate test copies (files, tasks, settings, explainer, voice;
  `--interactive` adds the marker and real approval clicks).
* The Claude Agent SDK engine is optional (`BUDDY_ENGINE=sdk`) and left out of the installer (it would add the
  346 MB Claude Code program).

## 0.1.0

First release: Guide and Do modes, Mark and Explain plates, voice and dictation on the PC, task windows, routines,
Agents rules, Word documents, Settings, and self-updating installer.
