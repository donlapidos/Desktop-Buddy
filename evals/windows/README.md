# Recorded windows

Real app windows, read the way Buddy reads them when it looks (`LOOK_ARGS` in `src/desktop.js`), for the model
check (`src/evals.js`, roadmap Phase 2). Each file says the app, what was open, the day it was recorded, the
agent-desktop version, and what was replaced. Record a window once it has finished opening: a read taken while it's
still settling can come back partial.

Recorded only from made-up or public content: sample files (a budget CSV, a Word report, a PDF, a text file), a
Wikipedia article, and app screens with nothing personal on them. Names, email addresses, numbers that could be
phone or account numbers, the user's folder, the PC's name and web address paths are replaced with placeholders
(`src/scrub.js`), and the account's organisation and shared-library names were given to `--names` as well. Each one
was read through before it was kept.

```bash
# More screens of the sample apps, stepped through and closed again (scripts/record-tour.mjs)
npm run record:tour -- --samples <folder with the sample files> --names "Org name,Shared library"
# One window that's open now
npm run record -- --list
npm run record -- --app EXCEL.EXE --window-id <id from --list> --name excel-blank --note "A new blank workbook" --names "Org name"
```

Before keeping a new one: read its texts for anything the scrubber can't know is private (an organisation, a client,
a colleague, a shared folder), and record it again with those in `--names`.
