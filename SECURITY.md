# Security

Desktop Buddy can see your screen, point, and (when you say yes) click and type in your apps. This page says what it
can touch, what it can't, what your "yes" means, and how to tell us about a security problem.

## Reporting a problem

If you find a way to make Buddy do something it shouldn't (act without your approval, read a place it says it never
touches, send a key somewhere it shouldn't go), please report it privately: on
[the repository's Security tab](https://github.com/donlapidos/Desktop-Buddy/security), choose **Report a
vulnerability**. Please don't open a public issue for it.

Say what you did, what happened, and which version of Buddy (Settings › About). Fixes go into the latest release only;
older versions aren't kept up to date.

Ordinary bugs go through **Report a problem** in the tray, which shows you the whole report before anything is sent.

## What Buddy can do

| What | When |
|---|---|
| Read the window you ask about: its text, and a picture of it when the AI can see images | When you ask a question. Automatic pictures can be turned off (Settings › AI & privacy) and skip the apps on your Never act in list. |
| Point and draw on your screen | Whenever it guides you. Drawing never clicks or types. |
| Click, type, press keys, open apps and move windows | Only after you say yes on Buddy's card, unless your Agents rules say otherwise (below). Never in an app on the Never act in list (password managers to start). Never on a spot it only guessed from a picture. |
| Read files and folders | Freely in the folders listed in Settings › Agents (Documents, Desktop, Downloads to start) and its own Documents › Buddy folder; anywhere else asks first. |
| Make or change files | Always asks first. A file it replaces or edits is kept for a week, and Activity can undo it. |
| Read web pages | Asks for each website. Addresses on your PC or your local network are never fetched, redirects included. |
| Use a connected service (Notion, Linear, Jira and Confluence) | Only after you connect it, signing in in your browser, and only with the advanced features on. Every action asks on Buddy's card, naming the service; "Allow for this task" covers that one service. What it sends back is treated as information, never instructions, and anything shaped like a key is hidden. |
| Play a lesson (one you saved or one someone shared) | It only points and follows you, like guiding; it never clicks, types or opens anything, and calls no AI. An imported lesson is checked to be only steps and short words. |
| Run PowerShell commands | Off until you turn it on (Settings › Agents › Let Buddy run commands). On, it asks before every command, and each one runs walled off: only Buddy's own folder, no internet. Your files go in as copies, when you allow it. |

### What your "yes" means

- **Allow** lets that one action happen.
- **Allow for this task** lets more of the *same kind* through until the answer ends: screen actions, file changes,
  PowerShell, and each website, separately. Saying it for a file change doesn't let a command or a website through.
- **Don't** stops the action; the AI is told you declined.
- The card can be answered only from Buddy's own bubble, and not in its first half second, so a click that was
  already on its way can't answer it.
- Your Agents rules can let some actions through without the card: **Make safe moves** (scrolling, expanding,
  moving windows), or **Act freely in apps I trust** for the apps you list. The default is to ask every time.

## What Buddy never touches

The file tools refuse these whatever the AI asks and whatever you approve:

- Windows, Program Files and ProgramData.
- Other people's folders on this PC, and network locations.
- Saved passwords and keys: `.ssh`, `.aws`, `.azure`, `.gnupg`, `.kube`, `.docker`, and Windows' saved credentials.
- Browser profiles (Chrome, Edge, Firefox, Brave).
- The AI apps' own settings (Claude, Claude Code, Codex, Gemini, Cursor, Windsurf, LM Studio, VS Code).
- Buddy's own data folder, which holds your API keys.

None of these, nor your whole user folder, AppData or a whole drive, can be added to the folders Buddy reads without
asking, even by editing the settings file.

Anything shaped like a secret key (API keys, GitHub and Slack tokens, AWS key ids, private keys) is hidden from the AI
in what Buddy reads.

## Your keys

API keys are stored encrypted by Windows (DPAPI), one per provider, and are sent only to their own provider. A key for
"Another server" is tied to the address it was entered for. PowerShell runs without any keys in its environment. The
Settings window never receives a saved key, and the problem report leaves keys and your files' paths out.

## Connected services

Buddy only lists services whose own servers let an app sign in by itself, with the safeguards for that (OAuth 2.1
with PKCE): you sign in on the service's page in your browser, and Buddy never sees your password. What the service
gives Buddy for that (its sign-in tokens) is kept encrypted by Windows in Buddy's data folder, sent only to that
service, and deleted when you disconnect. The browser comes back to a one-off address on this PC that accepts a single
sign-in carrying the code Buddy sent, and Buddy only opens secure (https) sign-in pages.

## Your AI app

When you use Buddy from an AI app (Claude Code, Codex, Cursor and others), that app talks to Buddy over a pipe on this
PC, and is served only after presenting a token that changes each time Buddy starts. The token is kept in Buddy's data
folder, which the file tools never open.
Looking and pointing run without a card there; acting still asks on Buddy's card, under the same rules.

## Limits we know about

- **Commands run walled off, and can't be undone.** A PowerShell command runs inside a Windows sandbox (an
  AppContainer, as Store apps use): it can reach only Buddy's own folder (Documents › Buddy) and has no internet, so
  it can't read or change anything else of yours, whatever it tries. Your other files reach it only as copies Buddy
  brings in, which you approve, so a command never changes an original. Inside that folder a command can still change
  or remove what's there, which Buddy can't undo. That is why commands are off until you turn them on, and why each
  one asks.
- **Text on screen can try to steer the AI.** A web page, document or email can contain words written to look like
  instructions. Buddy tells the AI they aren't from you, and its tests check that a model ignores them, but no AI is immune.
  The approval card is the backstop: nothing is clicked, typed, changed or run without it (or your Agents rules).
- **Looking isn't asked about.** When you ask a question, Buddy reads that window without a card, and the AI you
  chose sees it. Don't ask Buddy about a window holding something you wouldn't send to that AI company.
- **The installer isn't signed yet**, so Windows SmartScreen warns about it. Updates come only from this repository's
  GitHub releases and are checked against their published checksum before installing.

What leaves your PC, provider by provider, is in [AI and privacy](docs/GUIDE.md#ai-and-privacy).
