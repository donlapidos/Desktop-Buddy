# The launch demos

Two clips: the pivot table rescue (the main one, for the website) and building in Blender (the second).

## Clip 1: pivot table rescue

About a minute, cut to 30 seconds for the website. A sales export nobody wants to dig through becomes a pivot table,
an answer, an explanation and a report for the boss, with Buddy pointing the way and asking before it makes anything.

### Before you record

- **Buddy:** the released 0.4.0, thinking with your OpenAI key (`gpt-6.1-sol`, the model the demo was rehearsed on).
  Settings › Agents › **Show advanced features** on (the Word report needs it).
- **Screen:** 1920 × 1080, Do Not Disturb on, Teams and anything else that pops up closed, a clean desktop.
- **The file:** open `scripts/samples/demo/Regional sales.xlsx` in Excel (made-up data: 2,000 orders, four regions,
  columns sized to fit; `node scripts/make-demo-sales.mjs` then `scripts/make-demo-workbook.ps1` make it again).
  Maximize Excel, **wait ten seconds, then click cell A1**: a sheet this size isn't readable to Buddy until Excel has
  settled. If Excel shows its Document Recovery pane, deal with it before recording: it lists your own files.
- **Recorder:** the whole screen, never one window (Buddy's pointer and captions are windows of their own). Snipping
  Tool's video mode (Win+Shift+R) works; OBS Studio with Display Capture is smoother.
- Rehearse twice. Delete the pivot sheet (or reopen the file without saving) between takes.

### The takes

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

### What the rehearsal found

`npm run eval -- --provider openai --model gpt-6.1-sol --set demo` (or `npm run eval:saved -- …` with the key saved
in Buddy) plays takes 1, 2 and 4 on Excel screens recorded along this route (`npm run record:tour -- --samples
scripts/samples/demo --only pivot`). Each run costs a few cents.

- Takes 1 and 2: 5 of 5 runs with the question above, every time Insert → PivotTable → OK → Region → Quarter, then
  pointing at the West row's figures.
- Take 4: 7 of 8 runs made one document. Once it made a second, revised one: if a second card comes up, press
  **Don't** and carry on.
- Model time for take 1 was usually about 30 s, once 110 s. Cut the waits in editing.
- Rehearsed again on the screens recorded from the workbook: both scenes passed in both runs.

## Clip 2: building in Blender

About a minute, sped up in the middle: a cabin appears part by part in Blender while Buddy builds it.

### Before you record

- Blender 5.1 or later with Blender Lab's MCP add-on installed and enabled (docs/GUIDE.md, Build in Blender). Buddy
  with the advanced features on.
- Close Blender, so the clip can start with Buddy opening it. Or open it yourself and start the add-on's server.
- In Blender, switch the 3D view to **Material Preview** (the third sphere at its top right) once it's open, so the
  colours show as parts arrive. Keep Blender in front while it builds: in the background it doesn't redraw.

### The takes

1. Press Ctrl+Alt+B and say: *"Open Blender and build a cozy little cabin in the woods, with a warm light glowing in
   the window."* Buddy asks to open Blender: **Allow**. Then it asks to build: **Allow for this task**, so it doesn't
   ask again for each part.
2. Watch it build: ground, foundation, walls, roof, door, window, chimney, trees, a path, then the light and the
   camera. It checks its work with a picture of the view and fixes what looks wrong.
3. Optional: *"Make the roof red."* Then press Ctrl+Z in Blender to show any change can be undone.

### What the rehearsal found

`npm run eval -- --provider openai --model gpt-6.1-sol --set blender` (a stand-in Blender) passed 6 of 6; with
`--live-blender`, in the real Blender, it built a 35-part cabin in about 95 s. The triangular ends of the roof stay open
(Buddy builds from boxes, cones and spheres): frame the camera so they don't show, or ask Buddy to close them.


### After recording (both clips)

Send the raw file. It gets trimmed, made small for the web (muted and looping on the site; Buddy's captions tell the
story), given a poster frame, and added as `docs/media/buddy-demo.mp4`.
