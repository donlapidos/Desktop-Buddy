// Isolated native-window check. Imported only by the BUDDY_ANNOTATIONS_TEST hook; no model or real mouse is used.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Brain } from "./brain.js";
import { listWindows } from "./desktop.js";

export async function runAnnotationTest({ script, out, showAnnotations, annotationLayer, toLocalRect, point, release }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (check, ms = 12_000) => { for (const end = Date.now() + ms; Date.now() < end; await wait(50)) if (await check()) return true; return false; };
  let sample, otherSample, b;
  const result = {};
  try {
    sample = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-Focus"], { windowsHide: false });
    let errors = "";
    sample.stderr.on("data", (chunk) => { errors += chunk; });
    sample.stdout.resume();
    await new Promise((resolve, reject) => { sample.once("spawn", resolve); sample.once("error", reject); });
    /** @type {any} */
    let target;
    if (!(await until(async () => { target = (await listWindows()).find((w) => w.title === "Buddy visual context sample" && w.pid === sample.pid); return !!target; }))) throw new Error(`Sample window unavailable: ${errors.slice(0, 300)}`);
    if (!target) throw new Error("Sample window missing.");
    /** @type {any} */
    let last;
    let ready = false;
    b = new Brain({ status() {}, point: (bounds, text) => point(bounds, text, "bubble"),
      // The only action this check approves is a semantic invocation of a control from its own sample window.
      confirm: async () => "allow", trace: (event) => { if (event.kind === "guide-ready") ready = true; },
      annotate: async (items, context) => { last = { items, context }; return showAnnotations(items, context, "bubble"); },
      clearAnnotations: (ms = 0) => annotationLayer.release("bubble", ms),
    });
    b.target = target;
    b.abort = new AbortController();
    await b.look({ app: target.app_name, window_id: target.id }, { windowOnly: true });
    const ref = (text) => [...b.labels].reverse().find(([, label]) => label.includes(text))?.[0];
    const source = ref("Quarterly sales details"), destination = ref("Destination");
    if (!source || !destination) throw new Error("The native sample's two controls weren't readable.");
    const { win, rect } = toLocalRect(b.bounds.get(source));
    const js = (code) => win.webContents.executeJavaScript(code);
    if (!(await until(() => js(`document.body.dataset.annotationsReady === "true"`)))) throw new Error("The annotation renderer didn't initialize.");
    result.kinds = [];
    result.answers = [];
    for (const kind of ["highlight", "circle", "arrow", "label", "drag"]) {
      const answer = await b.runTool("annotate", { caption: "From here to there", items: [{ kind, ref: source,
        ...(["arrow", "drag"].includes(kind) ? { to_ref: destination } : {}), label: kind === "label" ? "<img src=x onerror=bad()>" : "From here to there", number: 1 }] });
      const rendered = answer.startsWith("Annotated.") && await until(() => js(`!!document.querySelector('#annotations [data-kind="${kind}"]')`));
      result.answers.push(answer);
      if (rendered) result.kinds.push(kind);
      if (kind === "label") result.escaped = await js(`document.querySelector('.annotation-label')?.textContent === '<img src=x onerror=bad()>' && !document.querySelector('#annotations img')`);
    }
    await wait(250);
    if (out) {
      const image = await b.screenImage(target, b.abort.signal);
      if (image) fs.writeFileSync(path.join(out, "annotations-window.png"), Buffer.from(image.source.data, "base64"));
      const area = win.getBounds();
      const crop = { x: Math.max(0, Math.round(rect.x - 40)), y: Math.max(0, Math.round(rect.y - 140)),
        width: Math.min(700, Math.round(area.width - Math.max(0, rect.x - 40))), height: Math.min(300, Math.round(area.height - Math.max(0, rect.y - 140))) };
      fs.writeFileSync(path.join(out, "annotations.png"), (await win.webContents.capturePage(crop)).toPNG());
    }
    // Another task owns the layer now; clearing the bubble's drawings must leave that task alone.
    if (!last) throw new Error("No drawing reached the display layer.");
    await showAnnotations(last.items, last.context, "annotation-task");
    await b.runTool("clear_annotations", {});
    result.ownerIsolated = annotationLayer.owner() === "annotation-task";
    annotationLayer.clear("annotation-task");

    // Prove a live route ends only after its expected result appears, and clears its drawing at the end.
    const route = b.guideSteps({ steps: [{ target: "Quarterly sales details", caption: "Open the details", done_when: ["Details opened"], annotation: { kind: "circle" } }], seconds_per_step: 15 });
    if (!(await until(() => ready))) { b.cancel(); await route; throw new Error("The guide never started waiting for its expected result."); }
    const acted = await b.act({ action: "click", ref: source });
    result.sampleClick = acted.includes('"ok":true');
    result.route = await route;
    result.routeCleared = await until(() => js(`document.getElementById('annotations').children.length === 0`));

    // Replacing a drawing and immediately interrupting must leave no late caption or annotation behind.
    await b.look({ app: target.app_name, window_id: target.id }, { windowOnly: true });
    const fresh = ref("Quarterly sales details");
    await b.drawAnnotations({ items: [{ kind: "highlight", ref: fresh, label: "Stop test" }] });
    b.cancel();
    result.cancelCleared = await until(() => js(`document.getElementById('annotations').children.length === 0`));
    const flying = point(b.bounds.get(fresh), "Old caption", "bubble");
    release("bubble", 0);
    await flying;
    result.noLateCaption = await js(`!document.getElementById('caption').classList.contains('on')`);

    // A real control changes position without moving the window: its drawing must expire on validation.
    b.abort = new AbortController();
    const changed = ref("Details opened");
    if (!(await b.drawAnnotations({ items: [{ kind: "circle", ref: changed, label: "Watch this control" }] })).startsWith("Annotated.")) throw new Error("The movement check couldn't show its drawing.");
    await b.act({ action: "click", ref: fresh });
    result.movementCleared = await until(() => annotationLayer.owner() === null);
    if (!(await b.drawAnnotations({ items: [{ kind: "highlight", ref: fresh, label: "Focus test" }] })).startsWith("Annotated.")) throw new Error("The focus check couldn't show its drawing.");
    otherSample = spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-Focus", "-Title", "Buddy annotation focus sample"], { windowsHide: false });
    otherSample.stdout.resume(); otherSample.stderr.resume();
    await new Promise((resolve, reject) => { otherSample.once("spawn", resolve); otherSample.once("error", reject); });
    result.focusCleared = await until(() => annotationLayer.owner() === null);
  } catch (error) {
    result.error = error.message;
  } finally {
    b?.cancel(); annotationLayer.clear(); otherSample?.kill(); sample?.kill();
    console.log("ANNOTATIONS_TEST", JSON.stringify(result));
    console.log("ANNOTATIONS_TEST_DONE");
  }
}
