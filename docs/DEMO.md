# The launch demo: pivot table rescue

About a minute, cut to 30 seconds for the website. A sales export nobody wants to dig through becomes a pivot table,
an answer, an explanation and a report for the boss, with Buddy pointing the way and asking before it makes anything.

## Before you record

- **Buddy:** the released 0.4.0, thinking with your OpenAI key (`gpt-6.1-sol`, the model the demo was rehearsed on).
  Settings › Agents › **Show advanced features** on (the Word report needs it).
- **Screen:** 1920 × 1080, Do Not Disturb on, Teams and anything else that pops up closed, a clean desktop.
- **The file:** open `scripts/samples/demo/Regional sales.csv` in Excel (made-up data: 2,000 orders, four regions;
  `node scripts/make-demo-sales.mjs` makes it again). Maximize Excel, **wait ten seconds, then click cell A1**: a
  sheet this size isn't readable to Buddy until Excel has settled.
- **Recorder:** the whole screen, never one window (Buddy's pointer and captions are windows of their own). Snipping
  Tool's video mode (Win+Shift+R) works; OBS Studio with Display Capture is smoother.
- Rehearse twice. Delete the pivot sheet (or reopen the file without saving) between takes.

## The takes

**1. The question (about 30 s).** Hold Ctrl+Alt+B and say exactly:

> "Which region grew the most from Q1 to Q4? Show me how, with a pivot table."

Keep "from Q1 to Q4": asked about "this year", the model stops to ask whether you mean against last year.
Buddy's pointer goes **Insert → PivotTable → OK**, then to **Region**, **Revenue** and **Quarter** in the field list
(Quarter across the top, as Columns). Click each as it points; it moves on when it sees you did.

**2. The answer.** Ask: *"So which one grew the most?"* Buddy says West grew from 38,442 to 136,479 (about 255%) and
points at West's Q1 and Q4 figures in the table.

**3. The explanation (optional).** Hover over the PivotTable Fields pane and press Ctrl+Alt+E: an illustrated page on
how a pivot table works. Not rehearsed by the model check (below), so try it once before the take.

**4. The report.** Say: *"Turn this into a one-page summary for my boss in Word."* The approval card shows what it will
make; press **Allow**. Word opens a one-page summary: a table by region, West's share going from 19% to 47.5% of
quarterly revenue, and what to look into next.

## What the rehearsal found

`npm run eval -- --provider openai --model gpt-6.1-sol --set demo` (or `npm run eval:saved -- …` with the key saved
in Buddy) plays takes 1, 2 and 4 on Excel screens recorded along this route (`npm run record:tour -- --samples
scripts/samples/demo --only pivot`). Each run costs a few cents.

- Takes 1 and 2: 5 of 5 runs with the question above, every time Insert → PivotTable → OK → Region → Quarter, then
  pointing at the West row's figures.
- Take 4: 7 of 8 runs made one document. Once it made a second, revised one: if a second card comes up, press
  **Don't** and carry on.
- Model time for take 1 was usually about 30 s, once 110 s. Cut the waits in editing.

## After recording

Send the raw file. It gets trimmed, made small for the web (muted and looping on the site; Buddy's captions tell the
story), given a poster frame, and added as `docs/media/buddy-demo.mp4`.
