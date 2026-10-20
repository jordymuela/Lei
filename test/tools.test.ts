import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOLS, runTool } from "../server/tools.ts";

test("every tool streams its input eagerly", () => {
  assert.ok(TOOLS.every((t) => t.eager_input_streaming === true));
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
