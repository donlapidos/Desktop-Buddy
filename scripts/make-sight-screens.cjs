// Makes the "sight" eval set's screenshots (evals/screens/): five screens with nothing an accessibility tree can name
// (a paint canvas, a scanned PDF, a remote desktop, a chart picture, a game menu), each with the box of the thing a
// case asks about. Drawn here from HTML, so the boxes are exact and nothing personal is in them.
//   npx electron scripts/make-sight-screens.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const W = 1280, H = 800;
const out = path.join(__dirname, "..", "evals", "screens");
const page = (body, bg = "#fff") => `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; font-family: "Segoe UI", sans-serif; }
  .a { position: absolute; box-sizing: border-box; }
</style><body>${body}</body>`;
const box = (x, y, w, h, style = "", inner = "") => `<div class="a" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${style}">${inner}</div>`;

/** Each screen: its picture, and the box (pixels) of the thing its case asks about. */
const SCREENS = {
  "paint-canvas": {
    target: { x: 236, y: 14, width: 44, height: 44 },
    html: page([
      box(0, 0, W, 72, "background:#f3f3f3;border-bottom:1px solid #ccc"),
      // Brush, fill bucket, eraser, text, shapes: drawn shapes, no labels, as on a canvas toolbar.
      box(20, 14, 44, 44, "border-radius:6px;background:#e3e3e3", `<svg width="44" height="44"><path d="M12 32 L28 12 L32 16 L16 36 Z" fill="#5a3"/><circle cx="12" cy="34" r="4" fill="#333"/></svg>`),
      box(92, 14, 44, 44, "border-radius:6px;background:#e3e3e3", `<svg width="44" height="44"><path d="M10 22 L22 10 L34 22 L22 34 Z" fill="#48c"/><path d="M34 24 q4 6 0 10 q-4 -4 0 -10" fill="#48c"/></svg>`),
      box(164, 14, 44, 44, "border-radius:6px;background:#e3e3e3", `<svg width="44" height="44"><text x="12" y="32" font-size="24" font-weight="700" fill="#333">A</text></svg>`),
      box(236, 14, 44, 44, "border-radius:6px;background:#e3e3e3", `<svg width="44" height="44"><rect x="10" y="16" width="24" height="14" rx="3" fill="#f6a" transform="rotate(-30 22 23)"/><rect x="10" y="23" width="12" height="7" fill="#fff" stroke="#333" transform="rotate(-30 22 23)"/></svg>`),
      box(308, 14, 44, 44, "border-radius:6px;background:#e3e3e3", `<svg width="44" height="44"><rect x="9" y="11" width="16" height="12" fill="none" stroke="#333" stroke-width="2"/><circle cx="28" cy="28" r="8" fill="none" stroke="#333" stroke-width="2"/></svg>`),
      box(40, 110, 1200, 650, "background:#fff;box-shadow:0 0 0 1px #ccc", `<svg width="1200" height="650"><path d="M100 400 C 300 100, 500 600, 800 250" stroke="#2a6" stroke-width="14" fill="none"/><circle cx="950" cy="420" r="90" fill="#fc3"/></svg>`),
    ].join(""), "#ddd"),
    ask: "This is a drawing app. Which button is the eraser?",
  },
  "pdf-scan": {
    target: { x: 300, y: 610, width: 360, height: 40 },
    html: page([
      box(240, 20, 800, 760, "background:#fbfaf6;box-shadow:0 2px 12px rgba(0,0,0,.35);transform:rotate(-.4deg)", [
        `<div style="padding:60px 70px;color:#222;font-family:'Courier New',monospace;font-size:17px;line-height:1.7">`,
        `<div style="font-size:24px;font-weight:700;letter-spacing:2px">PERMISSION FORM</div><br>`,
        `Name of participant: ______________________<br>Date of the trip: 14 March<br>Destination: Science museum<br>`,
        `Packed lunch needed: yes / no<br><br>I give permission for my child to take part in the trip described above.<br>`,
        `</div>`,
      ].join("")),
      box(300, 610, 360, 40, "border-bottom:2px solid #222"),
      box(300, 654, 360, 24, "font-family:'Courier New',monospace;font-size:15px;color:#222", "Signature of parent or guardian"),
      box(720, 610, 220, 40, "border-bottom:2px solid #222"),
      box(720, 654, 220, 24, "font-family:'Courier New',monospace;font-size:15px;color:#222", "Date"),
    ].join(""), "#525659"),
    ask: "This PDF is a scan. Where do I sign it?",
  },
  "remote-desktop": {
    target: { x: 30, y: 30, width: 90, height: 96 },
    html: page([
      box(0, 0, W, H, "background:linear-gradient(135deg,#1e5a8a,#0d2a44)"),
      // Desktop icons: a bin, a folder, a spreadsheet; their names are only pixels in the remote picture.
      box(30, 30, 90, 96, "", `<svg width="90" height="60"><path d="M30 14 h30 l-3 40 h-24 Z" fill="#cfd8dc" stroke="#fff" stroke-width="2"/><rect x="26" y="8" width="38" height="6" fill="#fff"/></svg><div style="color:#fff;font-size:13px;text-align:center;text-shadow:0 1px 2px #000">Recycle Bin</div>`),
      box(30, 150, 90, 96, "", `<svg width="90" height="60"><path d="M20 16 h18 l4 6 h28 v32 h-50 Z" fill="#f4c542"/></svg><div style="color:#fff;font-size:13px;text-align:center;text-shadow:0 1px 2px #000">Documents</div>`),
      box(30, 270, 90, 96, "", `<svg width="90" height="60"><rect x="25" y="8" width="40" height="48" fill="#fff"/><rect x="25" y="8" width="40" height="12" fill="#1d6f42"/></svg><div style="color:#fff;font-size:13px;text-align:center;text-shadow:0 1px 2px #000">Rota.xlsx</div>`),
      box(0, 752, W, 48, "background:rgba(20,20,24,.92)"),
      box(560, 758, 36, 36, "", `<svg width="36" height="36"><rect x="6" y="6" width="11" height="11" fill="#4cc2ff"/><rect x="19" y="6" width="11" height="11" fill="#4cc2ff"/><rect x="6" y="19" width="11" height="11" fill="#4cc2ff"/><rect x="19" y="19" width="11" height="11" fill="#4cc2ff"/></svg>`),
      box(980, 6, 290, 26, "background:#2b2b2b;color:#ddd;font-size:12px;padding:5px 10px", "Remote Desktop: office-pc"),
    ].join("")),
    ask: "I'm looking at my office PC over Remote Desktop. Where's the Recycle Bin on it?",
  },
  "chart-image": {
    target: { x: 676, y: 210, width: 90, height: 450 },
    html: page([
      box(80, 40, 1120, 50, "font-size:28px;font-weight:600;color:#222", "Visitors by month"),
      ...[["Jan", 180], ["Feb", 240], ["Mar", 310], ["Apr", 270], ["May", 450], ["Jun", 390], ["Jul", 220]].map(([m, h], i) =>
        box(140 + i * 134, 660 - h, 90, h, `background:${m === "May" ? "#3a7bd5" : "#3a7bd5"}`) + box(140 + i * 134, 670, 90, 30, "text-align:center;font-size:18px;color:#444", m)),
      box(120, 660, 1040, 2, "background:#888"),
    ].join("")),
    ask: "This chart is a picture. Which month had the most visitors? Show me its bar.",
  },
  "game-menu": {
    target: { x: 490, y: 470, width: 300, height: 64 },
    html: page([
      box(0, 0, W, H, "background:radial-gradient(circle at 50% 30%,#3b2a5a,#120a1c)"),
      box(340, 120, 600, 120, "color:#f5d76e;font-size:72px;font-weight:800;text-align:center;letter-spacing:4px;text-shadow:0 4px 0 #6b4a00", "STAR FARM"),
      ...["New game", "Load game", "Settings", "Quit"].map((t, i) =>
        box(490, 310 + i * 80, 300, 64, "border-radius:14px;background:#6a4ca8;border:3px solid #f5d76e;color:#fff;font-size:26px;font-weight:700;display:grid;place-items:center", t)),
    ].join("")),
    ask: "How do I open this game's settings?",
  },
  // The next three have small targets, as in design and 3D apps: a near miss in pixels is a miss.
  "design-toolbar": {
    target: { x: 132, y: 8, width: 32, height: 32 },
    html: page([
      box(0, 0, W, 48, "background:#2c2c2c;border-bottom:1px solid #444"),
      // Move, frame, rectangle, pen, text, hand, comment: icons only, as in a design tool's toolbar.
      ...[
        `<path d="M9 6 L9 25 L14 20 L18 28 L21 27 L17 19 L24 19 Z" fill="#eee"/>`,
        `<path d="M11 5 V27 M21 5 V27 M5 11 H27 M5 21 H27" stroke="#eee" stroke-width="2"/>`,
        `<rect x="7" y="8" width="18" height="16" fill="none" stroke="#eee" stroke-width="2"/>`,
        `<path d="M16 4 L24 15 L19 27 H13 L8 15 Z" fill="none" stroke="#eee" stroke-width="2"/><circle cx="16" cy="16" r="2.5" fill="#eee"/><path d="M16 4 V13" stroke="#eee" stroke-width="1.5"/>`,
        `<text x="9" y="24" font-size="20" font-weight="700" fill="#eee" font-family="Segoe UI">T</text>`,
        `<path d="M10 17 V10 a2 2 0 0 1 4 0 V15 V8 a2 2 0 0 1 4 0 V15 V10 a2 2 0 0 1 4 0 V20 q0 7 -7 7 q-5 0 -8 -5 l-3 -5 a2 2 0 0 1 3 -2 Z" fill="none" stroke="#eee" stroke-width="1.6"/>`,
        `<path d="M6 8 H26 V21 H14 L9 26 V21 H6 Z" fill="none" stroke="#eee" stroke-width="2"/>`,
      ].map((icon, i) => box(12 + i * 40, 8, 32, 32, `border-radius:5px;${i === 0 ? "background:#0d99ff" : ""}`, `<svg width="32" height="32">${icon}</svg>`)),
      box(0, 49, 240, H - 49, "background:#2c2c2c;border-right:1px solid #444;color:#bbb;font-size:12px;padding:12px", "Layers<br><br>▸ Home screen<br>▸ Sign in<br>▸ Settings"),
      box(240, 49, 800, H - 49, "background:#1e1e1e"),
      box(330, 120, 260, 520, "background:#fff;border-radius:6px"),
      box(650, 120, 260, 520, "background:#fff;border-radius:6px"),
      box(1040, 49, 240, H - 49, "background:#2c2c2c;border-left:1px solid #444;color:#bbb;font-size:12px;padding:12px", "Design<br><br>W 260 &nbsp; H 520<br>Fill #FFFFFF"),
    ].join(""), "#1e1e1e"),
    ask: "In this design app, which button is the pen tool, for drawing my own shapes?",
  },
  "3d-viewport": {
    target: { x: 1206, y: 222, width: 28, height: 28 },
    html: page([
      box(0, 0, W, H, "background:#393939;background-image:linear-gradient(#444 1px,transparent 1px),linear-gradient(90deg,#444 1px,transparent 1px);background-size:64px 64px"),
      box(0, 0, W, 30, "background:#2b2b2b;color:#ccc;font-size:12px;padding:7px 12px", "Object Mode &nbsp; View &nbsp; Select &nbsp; Add &nbsp; Object"),
      // A cube in the middle of the scene.
      box(520, 300, 240, 220, "", `<svg width="240" height="220"><path d="M40 60 L140 20 L220 60 L120 100 Z" fill="#9a9a9a"/><path d="M40 60 L120 100 L120 210 L40 170 Z" fill="#7a7a7a"/><path d="M120 100 L220 60 L220 170 L120 210 Z" fill="#5f5f5f"/></svg>`),
      // The navigation gizmo (axes) and, under it, zoom, move the view, look through the camera, switch perspective.
      box(1150, 44, 110, 90, "", `<svg width="110" height="90"><line x1="55" y1="45" x2="95" y2="55" stroke="#e44" stroke-width="3"/><circle cx="95" cy="55" r="9" fill="#e44"/><line x1="55" y1="45" x2="75" y2="15" stroke="#7c4" stroke-width="3"/><circle cx="75" cy="15" r="9" fill="#7c4"/><line x1="55" y1="45" x2="55" y2="5" stroke="#48f" stroke-width="3"/><circle cx="55" cy="8" r="8" fill="#48f"/></svg>`),
      ...[
        `<circle cx="12" cy="12" r="6" fill="none" stroke="#ddd" stroke-width="2"/><path d="M16 16 L22 22" stroke="#ddd" stroke-width="2.5"/>`,
        `<path d="M8 13 V8 a1.5 1.5 0 0 1 3 0 V12 V6 a1.5 1.5 0 0 1 3 0 V12 V8 a1.5 1.5 0 0 1 3 0 V16 q0 6 -6 6 q-4 0 -6 -4 l-2 -4 a1.5 1.5 0 0 1 2.5 -1.5 Z" fill="none" stroke="#ddd" stroke-width="1.5"/>`,
        `<rect x="4" y="9" width="14" height="11" rx="2" fill="#ddd"/><path d="M18 12 L24 8 V21 L18 17 Z" fill="#ddd"/><circle cx="8" cy="6" r="3" fill="none" stroke="#ddd" stroke-width="1.5"/><circle cx="14" cy="6" r="3" fill="none" stroke="#ddd" stroke-width="1.5"/>`,
        `<path d="M4 6 H24 V22 H4 Z M4 14 H24 M14 6 V22" fill="none" stroke="#ddd" stroke-width="1.5"/>`,
      ].map((icon, i) => box(1206, 150 + i * 36, 28, 28, "border-radius:50%;background:rgba(80,80,80,.85)", `<svg width="28" height="28">${icon}</svg>`)),
    ].join(""), "#393939"),
    ask: "How do I look through the camera in this 3D app?",
  },
  "layers-panel": {
    target: { x: 970, y: 270, width: 24, height: 24 },
    html: page([
      box(0, 0, 950, H, "background:#535353"),
      box(150, 100, 650, 520, "background:linear-gradient(160deg,#88b4d8,#e8c79a);box-shadow:0 0 0 1px #333", `<div style="position:absolute;left:220px;top:200px;font:700 54px 'Segoe UI';color:#fff;text-shadow:0 3px 6px #0007">Summer</div>`),
      box(950, 0, 330, H, "background:#3c3c3c;border-left:1px solid #222"),
      box(950, 80, 330, 30, "color:#eee;font-size:13px;padding:7px 14px;border-bottom:1px solid #222", "Layers"),
      // Each row: the eye that shows or hides the layer, a thumbnail, its name.
      ...["Title text", "Sticker", "Shadow", "Photo", "Background"].map((name, i) =>
        box(950, 120 + i * 36, 330, 36, `border-bottom:1px solid #2e2e2e;${i === 3 ? "background:#4a5a70" : ""}`) +
        box(970, 126 + i * 36, 24, 24, "", `<svg width="24" height="24"><path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z" fill="none" stroke="#ddd" stroke-width="1.6"/><circle cx="12" cy="12" r="3.5" fill="#ddd"/></svg>`) +
        box(1004, 124 + i * 36, 34, 28, `background:${["#fff", "#f6a", "#555", "#9bc", "#eee"][i]};border:1px solid #222`) +
        box(1050, 130 + i * 36, 220, 20, "color:#ddd;font-size:13px", name)),
    ].join(""), "#535353"),
    ask: "How do I hide the Background layer in this photo editor?",
  },
};

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({ width: W, height: H, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  const index = {};
  for (const [name, s] of Object.entries(SCREENS)) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(s.html)}`);
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    fs.writeFileSync(path.join(out, `${name}.png`), img.resize({ width: W, height: H }).toPNG());
    index[name] = { width: W, height: H, target: s.target, ask: s.ask };
  }
  fs.writeFileSync(path.join(out, "screens.json"), `${JSON.stringify(index, null, 1)}\n`);
  console.log(`Wrote ${Object.keys(index).length} screens to ${out}`);
  app.quit();
});
