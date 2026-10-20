import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool, toolsFor } from "../server/tools.ts";

test("each mode gets its own tools, all streaming input eagerly", () => {
  assert.deepEqual(toolsFor("companion").map((t) => t.name), ["remember", "compose"]);
  assert.deepEqual(toolsFor("practice").map((t) => t.name), ["remember", "correct"]);
  assert.ok([...toolsFor("companion"), ...toolsFor("practice")].every((t) => t.eager_input_streaming === true));
});

test("correct needs what was said and a different, better version", () => {
  const ok = runTool("correct", { said: "I have 20 years", better: "I'm 20 years old", why: "Idade usa 'to be'." });
  assert.deepEqual(ok.correction, { said: "I have 20 years", better: "I'm 20 years old", why: "Idade usa 'to be'." });
  assert.equal(runTool("correct", { said: "ok", better: "ok", why: "" }).isError, true);
  assert.equal(runTool("correct", { said: "", better: "x" }).isError, true);
});

test("remember needs a non-empty fact", () => {
  assert.deepEqual(runTool("remember", { fact: "Has a cat named Miso." }), { result: "saved", isError: false, fact: "Has a cat named Miso." });
  assert.equal(runTool("remember", { fact: "  " }).isError, true);
  assert.equal(runTool("remember", { fact: 3 }).isError, true);
  assert.equal(runTool("remember", null).isError, true);
});

test("compose validates the score and reports its length", () => {
  const ok = runTool("compose", { title: "Rain", tempo: 60, melody: "C4:1 E4:1" });
  assert.equal(ok.isError, false);
  assert.equal(ok.song?.title, "Rain");
  assert.deepEqual(JSON.parse(ok.result), { ok: true, seconds: 2 });
  assert.equal(runTool("compose", { title: "x", melody: "la la la" }).isError, true);
});

test("unknown tools are errors", () => {
  assert.equal(runTool("launch", {}).isError, true);
});
