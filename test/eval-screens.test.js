import assert from "node:assert/strict";
import { test } from "node:test";
import { setBrainDefaults } from "../src/brain.js";
import { runEvals } from "../src/evals.js";
import { REAL_CASES } from "../evals/real-cases.mjs";

// A scripted model on an OpenAI-style server: it looks, points at the Data tab, waits for the user, then points at
// "Sort Z to A", which is only on the Data tab's screen. It finds each ref by name in what Buddy's tools handed back,
// so the case passes only if the window really changed between the two steps.
function scripted() {
  const said = [];
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "scripted" }] }));
    const body = JSON.parse(init.body);
    const results = body.messages.filter((m) => m.role === "tool").map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    const last = results.at(-1) ?? "";
    said.push(last);
    const ref = (pattern) => last.match(pattern)?.[1];
    const call = (name, args) => ({ choices: [{ delta: { tool_calls: [{ index: 0, id: `c${results.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: "tool_calls" }] });
    const step = [
      () => call("look", {}),
      () => call("point_at", { ref: ref(/(@\S+) tab "Data"/), caption: "Open Data" }),
      () => call("wait_for_user", { steps: ["Sort Z to A"] }),
      () => {
        const sort = ref(/(@\S+) button "Sort Z to A"/);
        return sort ? call("point_at", { ref: sort, caption: "Largest first" }) : { choices: [{ delta: { content: "No Sort Z to A here." }, finish_reason: "stop" }] };
      },
      () => ({ choices: [{ delta: { content: "Click Data, then Sort Z to A." }, finish_reason: "stop" }] }),
    ][Math.min(results.length, 4)]();
    return new Response(`data: ${JSON.stringify(step)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  };
  return { fetchImpl, said };
}

test("on a real case, the window changes to the next screen once the user is shown its control", async () => {
  const { fetchImpl, said } = scripted();
  const real = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  setBrainDefaults({ model: "claude-opus-5-5", effort: "low", providerModels: { custom: "scripted" } });
  try {
    const run = await runEvals({ provider: "custom", apiKey: "", baseURL: "http://scripted.test/v1", cases: REAL_CASES.filter((c) => c.id === "real-excel-sort") });
    const r = run.results[0];
    assert.equal(r.problem, null, r.problem ?? "");
    assert.deepEqual(r.calls.filter((c) => c.kind === "point").map((c) => c.name), ["Data", "Sort Z to A"]);
    assert.match(said[3], /window changed/, "waiting handed back the new screen");
  } finally {
    globalThis.fetch = real;
    setBrainDefaults({ model: "claude-opus-5-5", effort: "medium" });
  }
});
