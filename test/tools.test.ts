import assert from "node:assert/strict";
import { test } from "node:test";
import { runTool, toolsFor } from "../server/tools.ts";

const names = (tools: unknown[]) => tools.map((t) => (t as { name: string }).name);

test("each mode gets its own tools; custom tools stream their input eagerly", () => {
  assert.deepEqual(names(toolsFor("companion")), ["remember", "compose"]);
  assert.deepEqual(names(toolsFor("practice", { computer: true, web: true })), ["remember", "correct"]);
  const full = toolsFor("companion", { computer: true, web: true, model: "claude-opus-5-5" });
  assert.deepEqual(names(full), [
    "remember", "compose", "system_status", "list_directory", "find_files", "read_file", "open", "write_file", "run_command",
    "set_reminder", "cancel_reminder", "web_search", "web_fetch",
  ]);
  for (const t of full as { type?: string; eager_input_streaming?: boolean }[]) {
    if (!t.type) assert.equal(t.eager_input_streaming, true);
  }
});

test("practice mode never gets the computer tools", () => {
  const all = names(toolsFor("practice", { computer: true, web: true }));
  for (const n of ["run_command", "write_file", "open", "read_file"]) assert.ok(!all.includes(n));
});

test("Haiku gets the web tool versions it supports", () => {
  const web = toolsFor("companion", { web: true, model: "claude-haiku-5-5" }) as { type?: string }[];
  assert.ok(web.some((t) => t.type === "web_search_20250305"));
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
