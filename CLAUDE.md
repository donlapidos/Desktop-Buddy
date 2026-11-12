# Desktop Buddy: notes for agents

A Windows desktop assistant (Electron, plain JavaScript checked by TypeScript through JSDoc). What it does and how it
fits together: `README.md`. What to build next and why: `ROADMAP.md`. Look and feel: `DESIGN.md`, `PRODUCT.md`.

## Commands

```bash
npm install
npm run setup     # the pinned agent-desktop CLI into bin/ (checksum verified)
npm start         # run Buddy from source
npm run check     # type check every main-process module
npm test          # unit tests, no model calls, nothing on the desktop touched
npm run e2e       # the real app end to end, in separate test copies (windows appear briefly)
npm run e2e -- --exe "<path to Desktop Buddy.exe>"   # against a built or installed copy
npm run e2e -- --interactive                          # adds real mouse clicks: ask the owner first
npm run eval -- --provider <id> --model <id>          # the model check; spends the provider's credit
npm run dist      # the installer, into dist/
```

## Rules

- **Prove each protection.** After adding a rule (an approval, a place, a check), break it on purpose and see a test
  fail. If none does, the test is the bug. Tests that wait on something must time out, not hang.
- **Before every commit:** `npm run check`, `npm test`, and `npm run e2e` when main-process behaviour changed.
- **The owner's running Buddy:** read the tail of `%APPDATA%\desktop-buddy\timing.log` before restarting it; if it
  was used in the last couple of minutes, ask instead. Kill it by matching `electron.exe` command lines that contain
  this folder and not `mcp-server.js`.
- **Test copies** run with `--user-data-dir` and must leave the owner's startup entries, shortcuts and AI-app settings
  alone (the `firstrun` e2e check holds this).
- **Backslash-heavy edits** (paths, regexes): use the editor, not shell heredocs or inline Python, which have turned
  `\b` into a backspace byte and `\\` into `\` here. After any scripted edit, scan the file for control characters.
- **Anything public is the owner's call:** publishing a release, merging to `main`, deleting releases or tags. Prepare
  it, then hand over the exact command.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), lowercase after the
  colon, the why in the body.
- **Words the user reads** (UI, errors, approval cards, README): plain, for someone who isn't a developer.
- **agent-desktop** is an upstream dependency (`package.json` › `agentDesktop`). Bump it deliberately, from upstream's
  `checksums.txt`, and run the unit and end-to-end checks against the new binary before committing.
