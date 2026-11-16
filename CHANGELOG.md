# Desktop Buddy changelog

## Unreleased

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
