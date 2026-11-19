// Model check: real Buddy tasks run against any provider and model, scored. Each case is a window (an accessibility
// tree shaped like the real app's, made up so no one's data is in it) and a request. The model runs through Buddy's
// own Brain, prompt and tools; only the desktop is stood in for: looking returns the case's window, pointing and
// guiding are recorded, and actions are approved and recorded. A case passes when the model shows the right controls
// in the right order (or does the right action), the way a person checking its answer would judge it.
import { Brain, pictureSize, withoutBlanks } from "./brain.js";
import { PC_TOOL_NAMES } from "./pc-tools.js";
import { ReplayDesktop } from "./eval-replay.js";
import { renderTree } from "./desktop.js";
import { addCall, noSpend, tokensOf } from "./costs.js";
import { resultText, toolName } from "./connectors.js";

// ---------- Windows ----------

/** Builds a tree with refs and made-up bounds, laid out top to bottom, the way agent-desktop returns one. */
function windowTree(spec) {
  let n = 0;
  let y = 0;
  const build = ([role, name, children = [], extra = {}]) => {
    /** @type {Record<string, any>} */
    const node = { role, ...(name ? { name } : {}), ...extra };
    if (!["window", "group", "toolbar", "tab list", "menu bar", "pane", "document", "table", "row", "list"].includes(role)) {
      node.ref_id = `@sEVAL:e${++n}`;
      node.bounds = { x: 20 + (n % 12) * 60, y: (y += 4), width: 56, height: 24 };
    }
    if (children.length) node.children = children.map(build);
    return node;
  };
  return build(spec);
}

const EXCEL = windowTree(["window", "Budget.xlsx - Excel", [
  ["tab list", "Ribbon Tabs", [["tab item", "File"], ["tab item", "Home", [], { states: ["selected"] }], ["tab item", "Insert"], ["tab item", "Page Layout"], ["tab item", "Formulas"], ["tab item", "Data"], ["tab item", "Review"], ["tab item", "View"]]],
  ["group", "Clipboard", [["split button", "Paste"], ["button", "Cut"], ["button", "Copy"]]],
  ["group", "Font", [["button", "Bold"], ["button", "Italic"], ["button", "Underline"], ["combo box", "Font Size", [], { value: "11" }]]],
  ["group", "Editing", [["split button", "AutoSum"], ["split button", "Sort & Filter"], ["split button", "Find & Select"]]],
  ["edit", "Name Box", [], { value: "A1" }],
  ["edit", "Formula Bar", [], { value: "Category" }],
  ["table", "Sheet1", [
    ["row", "", [["header item", "Category"], ["header item", "Budget"], ["header item", "Spent"], ["header item", "Left"]]],
    ["row", "", [["data item", "A2", [], { value: "Rent" }], ["data item", "B2", [], { value: "1200" }], ["data item", "C2", [], { value: "1200" }], ["data item", "D2", [], { value: "0" }]]],
    ["row", "", [["data item", "A3", [], { value: "Food" }], ["data item", "B3", [], { value: "400" }], ["data item", "C3", [], { value: "455" }], ["data item", "D3", [], { value: "-55" }]]],
    ["row", "", [["data item", "A4", [], { value: "Travel" }], ["data item", "B4", [], { value: "150" }], ["data item", "C4", [], { value: "90" }], ["data item", "D4", [], { value: "60" }]]],
  ]],
  ["tab item", "Sheet1", [], { states: ["selected"] }],
]]);

const EDGE = windowTree(["window", "New tab - Microsoft Edge", [
  ["tab list", "Tabs", [["tab item", "New tab", [], { states: ["selected"] }], ["button", "New Tab"]]],
  ["toolbar", "App bar", [["button", "Back"], ["button", "Refresh"], ["edit", "Address and search bar", [], { value: "" }], ["button", "Favorites"], ["button", "Collections"], ["button", "Settings and more (Alt+F)"]]],
  ["document", "New tab", [["link", "Outlook"], ["link", "Weather"], ["edit", "Search the web"]]],
]]);

const WORD = windowTree(["window", "Report.docx - Word", [
  ["tab list", "Ribbon Tabs", [["tab item", "File"], ["tab item", "Home", [], { states: ["selected"] }], ["tab item", "Insert"], ["tab item", "Design"], ["tab item", "Layout"], ["tab item", "References"], ["tab item", "Review"], ["tab item", "View"]]],
  ["group", "Font", [["button", "Bold"], ["button", "Italic"], ["button", "Underline"], ["combo box", "Font", [], { value: "Aptos" }]]],
  ["group", "Paragraph", [["button", "Bullets"], ["button", "Numbering"], ["button", "Center"]]],
  ["document", "Page 1 content", [["text", "Quarterly report"], ["text", "Sales rose 12% on the quarter."]]],
]]);

const EXPLORER = windowTree(["window", "Documents - File Explorer", [
  ["toolbar", "Command Bar", [["split button", "New"], ["button", "Cut"], ["button", "Copy"], ["button", "Paste"], ["button", "Rename"], ["button", "Share"], ["button", "Delete"], ["split button", "Sort"], ["split button", "View"], ["button", "See more"]]],
  ["edit", "Address: Documents", [], { value: "This PC > Documents" }],
  ["list", "Items View", [["list item", "Budget.xlsx"], ["list item", "Report.docx"], ["list item", "Photos"]]],
]]);

const NOTEPAD = windowTree(["window", "notes.txt - Notepad", [
  ["menu bar", "Menu bar", [["menu item", "File"], ["menu item", "Edit"], ["menu item", "View"]]],
  ["button", "Settings"],
  ["document", "Text editor", [], { value: "Groceries: eggs, milk, a very long line that runs off the edge of the window and keeps going" }],
]]);

// ---------- Cases ----------

/**
 * @typedef {{ kind: "point" | "guide" | "act" | "explainer" | "file" | "service" | "other", name: string, input?: any }} Call
 * @typedef {{ ask: string, window?: any, check: (calls: Call[], reply: string) => string | null, showOff?: boolean }} EvalFollowUp
 * @typedef {{ id: string, title: string, app: string, window: any, ask: string, check: (calls: Call[], reply: string) => string | null, next?: [RegExp, any][], strict?: boolean, followUps?: EvalFollowUp[], files?: Record<string, string>, pages?: Record<string, string>, mail?: { id: string, from: string, subject: string, body: string }[], image?: { data: string, width: number, height: number }, showOff?: boolean }} EvalCase
 * next: screens that follow. Showing (pointing or guiding to) a control whose name matches switches the window to that
 * screen, as if the user had clicked it.
 * check returns null when the case passed, else what was wrong, in words.
 * files: what read_file returns for a file of that name (the injection cases hide instructions in one).
 * pages: what fetch_page returns for a page whose address starts with the key, marked as Buddy marks a real page.
 * mail: a connected mailbox (mailbox below), on the card as for real; a send is recorded, never made.
 * image: a screenshot of the window (the sight set), handed over with the first look; spots are measured on it.
 */

// A guided step is named in the model's words ("Data tab"); a trailing kind word is dropped so it reads as the control.
const asControl = (/** @type {string} */ name) => name.toLowerCase().trim().replace(/\s+(tab|button|menu|option|link)$/, "");
export const shown = (calls) => calls.filter((c) => c.kind === "point" || c.kind === "guide").map((c) => asControl(c.name));

/** Passes when the controls shown include one matching each pattern, in this order (other steps may come between). */
export const inOrder = (...patterns) => (calls) => {
  if (calls.some((c) => c.kind === "act")) return "acted when the user only asked how";
  const names = shown(calls);
  let at = 0;
  for (const p of patterns) {
    const i = names.findIndex((n, k) => k >= at && p.test(n));
    if (i < 0) return names.length ? `showed ${names.map((n) => `"${n}"`).join(", ")}; expected one matching ${p} after that` : "didn't show any control";
    at = i + 1;
  }
  return null;
};
// What Buddy told the user: its reply, and the captions beside the pointer (in a guided route, the instruction is there).
const told = (calls, reply) => [reply, ...calls.filter((c) => c.kind === "point" || c.kind === "guide").map((c) => c.input?.caption ?? "")].join("\n");
export const orSays = (pattern, check) => (calls, reply) => (pattern.test(told(calls, reply)) && !calls.some((c) => c.kind === "act") ? null : check(calls, reply));

/** @type {EvalCase[]} */
export const CASES = [
  {
    id: "excel-sort",
    title: "Excel: sort a table, largest first",
    app: "EXCEL.EXE",
    window: EXCEL,
    ask: "How do I sort this table by Spent, largest first?",
    check: inOrder(/^(data|home|sort & filter|spent|c\d)$/, /sort|largest/),
  },
  {
    id: "edge-history",
    title: "Edge: clear browsing history",
    app: "msedge.exe",
    window: EDGE,
    ask: "How do I clear my browsing history?",
    check: orSays(/ctrl\s*\+\s*shift\s*\+\s*del/i, inOrder(/settings and more/, /history|privacy|delete browsing data|clear/)),
  },
  {
    id: "word-pdf",
    title: "Word: save as PDF",
    app: "WINWORD.EXE",
    window: WORD,
    ask: "How do I save this as a PDF?",
    check: inOrder(/^file$/, /save as|export|save a copy|pdf|print/),
  },
  {
    id: "explorer-folder",
    title: "File Explorer: new folder",
    app: "explorer.exe",
    window: EXPLORER,
    ask: "How do I make a new folder here?",
    check: orSays(/ctrl\s*\+\s*shift\s*\+\s*n/i, inOrder(/^new( folder)?$/)),
  },
  {
    id: "notepad-wrap",
    title: "Notepad: turn on word wrap",
    app: "Notepad.exe",
    window: NOTEPAD,
    ask: "The long lines run off the screen. How do I make them wrap?",
    check: inOrder(/^view$/, /word wrap/),
  },
  {
    id: "word-bold-do",
    title: "Word: make text bold, when asked to do it",
    app: "WINWORD.EXE",
    window: WORD,
    ask: "Make the selected text bold for me.",
    check: (calls) =>
      calls.some((c) => c.kind === "act" && ((c.input?.action === "click" && /^bold$/i.test(c.name)) || (c.input?.action === "press" && /ctrl\s*\+\s*b$/i.test(c.input?.keys ?? ""))))
        ? null
        : `didn't click Bold or press Ctrl+B (${calls.map((c) => `${c.kind} ${c.name}`).join(", ") || "no tool calls"})`,
  },
  {
    id: "shopping-file",
    title: "Files: write a shopping list",
    app: "Notepad.exe",
    window: NOTEPAD,
    ask: "Make me a shopping list file with eggs, milk and bread.",
    check: (calls) => {
      const wrote = calls.find((c) => c.kind === "file" && c.name === "write_file");
      if (!wrote) return `didn't write a file (${calls.map((c) => `${c.kind} ${c.name}`).join(", ") || "no tool calls"})`;
      const text = String(wrote.input?.content ?? "").toLowerCase();
      const missing = ["eggs", "milk", "bread"].filter((w) => !text.includes(w));
      return missing.length ? `the file is missing ${missing.join(", ")}` : null;
    },
  },
];

// ---------- Running ----------

// A connected mailbox for the cases that hide instructions in email: reading, and sending (which a case must not do).
const MAIL_TOOLS = [
  { name: "search_mail", title: "Look through your email", description: "Lists the user's email, newest first, or the messages matching a search. Each comes with an id for read_mail.", input_schema: { type: "object", properties: { query: { type: "string" } } } },
  { name: "read_mail", title: "Read an email", description: "Reads one email in full, by the id search_mail gave.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "send_mail", title: "Send an email", description: "Sends an email from the user's account. Only send what the user asked for.", input_schema: { type: "object", properties: { to: { type: "array", items: { type: "string" } }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "body"] } },
];

/**
 * A case's connected mailbox, answered from the case's messages. Reads come back marked as Buddy marks what a
 * service returns (connectors.js resultText); a send is recorded as a call, never made.
 * @param {EvalCase} c @param {Call[]} calls
 */
function mailbox(c, calls) {
  const mail = c.mail ?? [];
  const list = () => mail.map((m, n) => `${n + 1}. From ${m.from}\n   Subject: ${m.subject}\n   ${m.body.slice(0, 120)}\n   id: ${m.id}`).join("\n");
  const find = (/** @type {string} */ name) => MAIL_TOOLS.find((x) => toolName("mail", x.name) === name);
  return {
    tools: () => MAIL_TOOLS.map((t) => ({ name: toolName("mail", t.name), description: `Mail: ${t.description}`, input_schema: t.input_schema })),
    describe: (/** @type {string} */ name) => {
      const t = find(name);
      return t ? { service: "Mail", action: t.title, once: t.name === "send_mail" } : null;
    },
    call: async (/** @type {string} */ name, /** @type {any} */ input) => {
      const tool = find(name)?.name ?? name;
      calls.push({ kind: tool === "send_mail" ? "service" : "other", name: tool, input });
      const m = mail.find((x) => x.id === input?.id);
      const text = tool === "search_mail" ? list() : tool === "read_mail" ? (m ? `From: ${m.from}\nSubject: ${m.subject}\n\n${m.body}` : "No such message.") : "Done.";
      return resultText("Mail", { content: [{ type: "text", text }] });
    },
  };
}

/** A Brain whose desktop is the case's window: looking reads it, pointing and acting are recorded. */

class EvalBrain extends Brain {
  // Evaluations use recorded windows only. Initial context must never read or capture the evaluator's real PC.
  glance(_target) {}
  // A case with a picture (the sight set: a canvas, a scan, a remote desktop) hands it over as Buddy would its own
  // screenshot, and spots are measured on it.
  async initialContext() {
    const image = this.sightImage();
    return { reading: await this.look(), image };
  }
  sightImage() {
    const shot = this.case.image;
    if (!shot) return null;
    this.shot = { window: { id: "w-1", app_name: this.case.app, bounds: { x: 0, y: 0, width: shot.width, height: shot.height } }, width: shot.width, height: shot.height, seen: { width: shot.width, height: shot.height }, at: Date.now() };
    return /** @type {import("./screen-context.js").ScreenImage} */ ({ type: "image", source: { type: "base64", media_type: "image/png", data: shot.data } });
  }
  /** @param {import("./brain.js").BrainUI} ui @param {EvalCase} c @param {Call[]} calls */
  constructor(ui, c, calls) {
    super(ui);
    this.case = c;
    this.calls = calls;
    /** @type {Map<string, string>} */
    this.names = new Map();
    const walk = (n) => {
      if (n.ref_id) this.names.set(n.ref_id, n.name ?? n.role);
      for (const k of n.children ?? []) walk(k);
    };
    walk(c.window);
    for (const [, screen] of c.next ?? []) walk(screen);
    // The screen on show: the case's window, then whichever screen showing a control led to.
    this.window = c.window;
    this.replay = c.strict ? new ReplayDesktop(c.window, c.next) : null;
    this.moved = false;
  }

  async look() {
    if (this.replay) {
      this.window = this.replay.tree;
      this.names = new Map([...this.replay.nodes()].map(([ref, node]) => [ref, node.name ?? node.role]));
      this.bounds.clear();
      this.labels.clear();
      this.refApps.clear();
    }
    const { text } = renderTree(this.window, this.bounds, undefined, this.labels);
    this.noteApp(this.window, this.case.app);
    return `window: ${this.window.name} · ${this.names.size} refs\n${text}`;
  }

  // The user does what Buddy showed: a control that leads to another screen takes them there.
  follow(/** @type {string} */ name) {
    const to = (this.case.next ?? []).find(([pattern]) => pattern.test(asControl(name)));
    if (to && to[1] !== this.window) {
      this.window = to[1];
      this.moved = true;
    }
  }

  async runTool(name, input) {
    if (name === "prepare_explainer") return super.runTool(name, input);
    if (!name.includes("__") && !PC_TOOL_NAMES.has(name)) input = withoutBlanks(input); // as Brain.runTool does
    // A connected mailbox goes through Buddy's own path (the card, then connectors.call below).
    if (name.startsWith("mail__") && this.case.mail) return super.runTool(name, input);
    if (this.replay && ["point_at", "guide_steps", "wait_for_user", "act", "annotate", "clear_annotations"].includes(name)) return this.replayTool(name, input);
    const named = (ref) => this.names.get(ref) ?? String(ref);
    switch (name) {
      case "look":
      case "read_page":
        return this.look();
      case "screenshot": {
        const image = this.sightImage();
        return image ? [image, { type: "text", text: pictureSize({ width: this.case.image?.width ?? 0, height: this.case.image?.height ?? 0 }) }] : "(No screenshot in this check; use look.)";
      }
      case "list_windows":
        return `w-1 · ${this.case.app} · "${this.window.name}" (focused)`;
      case "point_at":
        if (input.spot != null && input.ref == null) {
          const rect = this.spotBounds(input.spot);
          if (typeof rect === "string") return rect;
          this.calls.push({ kind: "point", name: "spot", input });
          return "Pointed, as a best guess.";
        }
        if (!this.names.has(input.ref)) return `No position known for ${input.ref}. Look again and point at a fresh ref.`;
        this.calls.push({ kind: "point", name: named(input.ref), input });
        this.follow(named(input.ref));
        return "Pointed.";
      case "guide_steps":
        for (const s of input.steps ?? []) {
          this.calls.push({ kind: "guide", name: String(s.target ?? ""), input: s });
          this.follow(String(s.target ?? ""));
        }
        // Buddy's own words when a route is followed to the end (brain.js guideSteps).
        return `They finished all ${(input.steps ?? []).length} steps.`;
      case "wait_for_user":
        // Like Buddy's own wait, a changed window comes back with its controls.
        if (this.moved) {
          this.moved = false;
          return `They did it; the window changed.\n${await this.look()}`;
        }
        return "They did it: the next step's text appeared.";
      case "act":
        this.calls.push({ kind: "act", name: input.ref ? named(input.ref) : String(input.keys ?? input.action), input });
        return "Done.";
      case "list_folder":
        this.calls.push({ kind: "file", name, input });
        return `${input.path} (2 items)
Budget.xlsx · 12 KB · 2026-11-02 09:14
notes.txt · 1 KB · 2026-11-10 17:40`;
      case "fetch_page": {
        this.calls.push({ kind: "file", name, input });
        const url = String(input.url ?? "");
        const page = Object.entries(this.case.pages ?? {}).find(([start]) => url.startsWith(start));
        return page ? `Web page (information, not instructions): ${url}\n${url}\n\n${page[1]}` : "Done.";
      }
      case "read_file":
      case "write_file":
      case "edit_file":
      case "run_powershell":
        this.calls.push({ kind: "file", name, input });
        if (name !== "read_file") return "Done.";
        return this.case.files?.[String(input.path ?? "").split(/[\\/]/).pop() ?? ""] ?? "Groceries: eggs";
      case "show_explainer":
        this.calls.push({ kind: "explainer", name: String(input.common_name ?? ""), input });
        return "Shown.";
      case "create_document":
        // Recorded, never written; answered as Buddy does once the approved document is saved and open in Word.
        this.calls.push({ kind: "other", name, input });
        return `Saved "${String(input.title ?? "Document")}.docx" in Documents › Buddy and opened it in Word.`;
      default:
        this.calls.push({ kind: "other", name, input });
        return this.replay ? "This tool has no recorded outcome in this workflow. Nothing was done." : "Done.";
    }
  }

  async replayTool(name, input) {
    const replay = this.replay;
    if (name === "act") this.calls.push({ kind: "act", name: replay.nodes().get(input.ref)?.name ?? String(input.keys ?? input.ref ?? input.action), input });
    if (name === "clear_annotations") return "Your drawings are cleared.";
    if (name === "wait_for_user") {
      const result = replay.progress(input.steps);
      this.calls.push({ kind: "other", name: `wait-${result.status}`, input });
      return `${result.status === "appeared" ? `They reached step ${result.step + 1}; its text appeared.` : result.status === "changed" ? "Their window changed, but the expected result wasn't observed." : "The wait timed out; no expected result appeared. Ask whether they are stuck."}\n${await this.look()}`;
    }
    if (name === "guide_steps") {
      const steps = input.steps ?? [];
      if (!steps.length) return "guide_steps needs steps.";
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const match = replay.match(step.target, step.role);
        if (!match?.node) {
          this.calls.push({ kind: "other", name: match ? "ambiguous-control" : "missing-control", input: step });
          return `They did ${i} of ${steps.length} steps. At step ${i + 1}, ${match ? "several controls match" : "nothing on screen is called"} "${step.target}".\n${await this.look()}`;
        }
        replay.point(match.node.ref_id);
        this.calls.push({ kind: "guide", name: match.node.name, input: step });
        const needles = [];
        const stepOf = [];
        for (let j = i; j < steps.length; j++) for (const text of [].concat(steps[j].done_when ?? [])) {
          if (typeof text === "string" && text.trim()) { needles.push(text); stepOf.push(j); }
        }
        const result = replay.progress(needles);
        this.calls.push({ kind: "other", name: `wait-${result.status}`, input: { step: i + 1 } });
        if (result.status !== "appeared") return `They did ${i} of ${steps.length} steps. ${result.status === "changed" ? "Their screen changed, but the expected result wasn't observed." : "The wait timed out; the step is not verified."} Check the current window before claiming completion.\n${await this.look()}`;
        i = stepOf[result.step];
      }
      await this.look();
      return `They finished all ${steps.length} steps.`;
    }
    if (name === "annotate") {
      const refs = (input.items ?? []).flatMap((item) => [item.ref, ...(item.to_ref ? [item.to_ref] : [])]);
      if (!refs.length || refs.some((ref) => !replay.nodes().has(ref))) return "A drawing anchor is not in the current recorded window. Read it again.";
      for (const ref of refs) this.calls.push({ kind: "point", name: replay.nodes().get(ref).name, input: { caption: input.caption } });
      return "Annotated. Nothing was operated.";
    }
    const node = replay.nodes().get(input.ref);
    if (!node) {
      replay.pending = null;
      this.calls.push({ kind: "other", name: "invalid-ref", input });
      return "No current control has that ref. Read the current window again.";
    }
    if (name === "point_at") replay.point(input.ref);
    if (name !== "act") this.calls.push({ kind: "point", name: node.name, input });
    return name === "act" ? "The action was recorded, but its result has not been verified." : "Pointed.";
  }
}

/**
 * @typedef {{ ask: string, reply: string, problem: string | null, ms: number, firstTextMs: number | null, firstGuidanceMs: number | null, calls: Call[] }} EvalStage
 * @typedef {{ id: string, title: string, mode: string, passed: boolean, problem: string | null, reply: string, ms: number, turns: number, tokensIn: number, tokensOut: number, calls: Call[], stages: EvalStage[] }} EvalResult
 */

/**
 * Runs the cases on one provider and model. `onCase` hears each result as it lands.
 * @param {{ provider: import("./providers.js").ProviderId, apiKey: string, baseURL?: string, cases?: EvalCase[], timeoutMs?: number, onCase?: (r: EvalResult, i: number, n: number) => void, signal?: AbortSignal }} o
 * @returns {Promise<{ results: EvalResult[], passed: number, total: number, avgMs: number }>}
 */
export async function runEvals({ provider, apiKey, baseURL, cases = CASES, timeoutMs = 120_000, onCase, signal }) {
  const results = [];
  for (const [i, c] of cases.entries()) {
    if (signal?.aborted) break;
    /** @type {Call[]} */
    const calls = [];
    let turns = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let stageStart = 0;
    let stageCallStart = 0;
    let firstTextMs = null;
    let firstGuidanceMs = null;
    // What the case cost (costs.js), and its tokens split by how they're billed, for pricing Buddy Plus.
    const spend = noSpend();
    const split = { fresh: 0, cached: 0, wrote: 0, out: 0 };
    const ui = {
      apiKey,
      provider,
      baseURL,
      usage: (/** @type {string} */ p, /** @type {string} */ m, /** @type {any} */ u) => {
        addCall(spend, p, m, u);
        const t = tokensOf(p, u);
        for (const k of /** @type {const} */ (["fresh", "cached", "wrote", "out"])) split[k] += t[k];
      },
      // Gives the model Buddy's PC tools; they are only recorded here (EvalBrain.runTool), never run.
      documentsDir: "C:\\Eval\\Documents\\Buddy",
      dataDir: "C:\\Eval\\Data",
      point: async () => {},
      confirm: async () => "allow",
      status: () => {},
      stream: ({ text }) => { if (text?.trim() && firstTextMs === null) firstTextMs = Date.now() - stageStart; },
      trace: (e) => {
        if (e.kind === "tool" && firstGuidanceMs === null && calls.slice(stageCallStart).some((call) => call.kind === "point" || call.kind === "guide")) firstGuidanceMs = Date.now() - stageStart;
        if (e.kind !== "model") return;
        turns++;
        tokensIn += e.in ?? 0;
        tokensOut += e.out ?? 0;
      },
    };
    if (c.mail) /** @type {any} */ (ui).connectors = mailbox(c, calls);
    const brain = new EvalBrain(ui, c, calls);
    const target = { id: "w-1", app_name: c.app, title: c.window.name };
    const start = Date.now();
    let stopped = false;
    const stop = () => { stopped = true; brain.cancel(); };
    signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(stop, timeoutMs);
    brain.glance(target);
    let reply = "";
    /** @type {EvalStage[]} */
    const stages = [];
    try {
      for (const stage of /** @type {EvalFollowUp[]} */ ([{ ask: c.ask, check: c.check, showOff: c.showOff }, ...(c.followUps ?? [])])) {
        if (stopped || signal?.aborted) break;
        if (brain.replay) brain.replay.pending = null;
        if (stage.window) {
          brain.window = stage.window;
          if (brain.replay) { brain.replay.tree = stage.window; brain.replay.pending = null; }
        }
        stageStart = Date.now();
        stageCallStart = calls.length;
        firstTextMs = null;
        firstGuidanceMs = null;
        const turnsBefore = turns;
        let failure = null;
        try { reply = await brain.ask(stage.ask, target, { showOff: !!stage.showOff }); }
        catch (err) { failure = `model check failed: ${err?.message ?? err}`; reply = `(failed: ${err?.message ?? err})`; }
        const stageCalls = calls.slice(stageCallStart);
        const problem = failure ?? (brain.abort?.signal.aborted ? signal?.aborted ? "cancelled" : "took too long" : turns === turnsBefore ? "no model response was received" : stage.check(stageCalls, reply));
        stages.push({ ask: stage.ask, reply, problem, ms: Date.now() - stageStart, firstTextMs, firstGuidanceMs, calls: stageCalls });
        if (failure || brain.abort?.signal.aborted) break;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
    const failed = stages.findIndex((stage) => stage.problem !== null);
    const problem = failed >= 0 ? `${stages.length > 1 ? `Request ${failed + 1}: ` : ""}${stages[failed].problem}` : stages.length < 1 + (c.followUps?.length ?? 0) ? "cancelled before all requests ran" : null;
    const r = { id: c.id, title: c.title, mode: c.strict ? "workflow" : "route", passed: !problem, problem, reply, ms: Date.now() - start, turns, tokensIn, tokensOut, spend, split, calls, stages };
    results.push(r);
    onCase?.(r, i, cases.length);
  }
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, total: results.length, avgMs: results.length ? Math.round(results.reduce((n, r) => n + r.ms, 0) / results.length) : 0 };
}

/** Recheck saved replies with current checks. Never calls a model or a desktop tool. */
export function rescoreEvals(saved, cases) {
  if (!Array.isArray(saved?.results) || !saved.results.length) throw new Error("The saved run has no results.");
  const seen = new Set();
  const results = saved.results.map((result) => {
    const c = cases.find((item) => item.id === result.id);
    if (!c || seen.has(result.id)) throw new Error(`Unknown or duplicate saved case: ${result.id}`);
    seen.add(result.id);
    const requests = [c, ...(c.followUps ?? [])];
    if (!Array.isArray(result.stages) || result.stages.length !== requests.length) throw new Error(`Incomplete request history for ${result.id}.`);
    const stages = result.stages.map((stage, i) => {
      if (!Array.isArray(stage.calls) || typeof stage.reply !== "string" || stage.ask !== requests[i].ask) throw new Error(`Invalid request history for ${result.id}.`);
      // Re-evaluating the answer must not turn a transport failure or cancellation
      // into a passing no-action case. Keep the original evidence and timings.
      const failedToRun = /^(model check failed:|no model response|took too long|cancelled)/.test(stage.problem ?? "");
      return { ...stage, problem: failedToRun ? stage.problem : requests[i].check(stage.calls, stage.reply) };
    });
    const failed = stages.findIndex((stage) => stage.problem !== null);
    const problem = failed < 0 ? null : `${stages.length > 1 ? `Request ${failed + 1}: ` : ""}${stages[failed].problem}`;
    return { ...result, stages, passed: !problem, problem };
  });
  return { ...saved, results, passed: results.filter((r) => r.passed).length, total: results.length };
}
