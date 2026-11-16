import assert from "node:assert/strict";
import { test } from "node:test";
import { earlyInput } from "../src/early-tools.js";

/** Every prefix of `json`, as a model would stream it. */
const prefixes = (json) => Array.from({ length: json.length + 1 }, (_, i) => json.slice(0, i));

test("guide_steps starts once its first step is complete, never earlier", () => {
  const input = { steps: [{ caption: "Click \"Insert\" {here}", target: "Insert", done_when: ["Table"] }, { caption: "Now Table", target: "Table" }], then_say: "Done." };
  const json = JSON.stringify(input);
  const firstEnd = json.indexOf("},{") + 1;
  for (const raw of prefixes(json)) {
    const got = earlyInput("guide_steps", raw);
    if (raw.length < firstEnd) assert.equal(got, null, `started at ${JSON.stringify(raw)}`);
    else assert.deepEqual(got, { step: input.steps[0] });
  }
});

test("point_at starts once its ref and caption are complete; a caption inside then_say doesn't count", () => {
  const input = { then_say: "The \"caption\": is here", ref: "@s1:e12", caption: "Here it is" };
  const json = JSON.stringify(input);
  const done = json.length - 1; // the caption's closing quote is the last thing before }
  for (const raw of prefixes(json)) {
    const got = earlyInput("point_at", raw);
    if (raw.length < done) assert.equal(got, null, `started at ${JSON.stringify(raw)}`);
    else assert.deepEqual(got, { ref: "@s1:e12", caption: "Here it is" });
  }
  assert.deepEqual(earlyInput("point_at", '{"mark": 2, "caption": "This one"'), { mark: 2, caption: "This one" });
  assert.equal(earlyInput("point_at", '{"caption": "This one", "mark": 1'), null, "a number may still be growing");
});

test("nothing that acts, or any other tool, ever starts early, whatever its arguments say", () => {
  for (const name of ["act", "launch_app", "create_document", "window", "write_file", "run_command", "show_explainer"]) {
    for (const raw of prefixes(JSON.stringify({ action: "click", ref: "@s1:e1", caption: "x", steps: [{ target: "Save", caption: "Save" }] }))) {
      assert.equal(earlyInput(name, raw), null, name);
    }
  }
});
