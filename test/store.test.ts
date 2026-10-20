import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { LIMITS, Store, addCorrection, addMemory, addMessage } from "../server/store.ts";

const tempFile = async () => path.join(await mkdtemp(path.join(tmpdir(), "lei-")), "nested", "state.json");

test("a fresh store starts empty and persists updates to disk", async () => {
  const file = await tempFile();
  const store = new Store(file);
  assert.deepEqual(await store.load(), { profile: null, memories: [], transcript: [], corrections: [] });
  await store.update((s) => addMessage(s, { role: "user", text: "hi", at: 1 }));
  const reloaded = await new Store(file).load();
  assert.equal(reloaded.transcript[0].text, "hi");
  assert.ok(JSON.parse(await readFile(file, "utf8")).transcript);
});

test("addMemory ignores duplicates and blanks", async () => {
  const store = new Store(await tempFile());
  const state = await store.load();
  assert.ok(addMemory(state, "Likes  rainy mornings."));
  assert.equal(addMemory(state, "likes rainy mornings."), null);
  assert.equal(addMemory(state, "   "), null);
  assert.equal(state.memories[0].text, "Likes rainy mornings.");
});

test("the transcript is trimmed to its limit", async () => {
  const store = new Store(await tempFile());
  const state = await store.update((s) => {
    for (let i = 0; i < LIMITS.transcript + 5; i++) addMessage(s, { role: "user", text: String(i), at: i });
  });
  assert.equal(state.transcript.length, LIMITS.transcript);
  assert.equal(state.transcript[0].text, "5");
});

test("reset deletes the file", async () => {
  const file = await tempFile();
  const store = new Store(file);
  await store.update((s) => addMessage(s, { role: "user", text: "x", at: 1 }));
  await store.reset();
  assert.deepEqual(await new Store(file).load(), { profile: null, memories: [], transcript: [], corrections: [] });
});

test("addCorrection ties a correction to the latest user message and skips repeats", async () => {
  const store = new Store(await tempFile());
  const state = await store.update((s) => {
    addMessage(s, { role: "user", text: "I go to beach yesterday", at: 10 });
    addMessage(s, { role: "assistant", text: "Nice!", at: 11 });
  });
  const c = addCorrection(state, { said: "I go to beach", better: "I went to the beach", why: "Passado: went." }, 12);
  assert.equal(c?.forAt, 10);
  assert.equal(addCorrection(state, { said: "I go to beach", better: "I went to the beach", why: "" }, 13), null);
  assert.equal(addCorrection(state, { said: "same", better: "same", why: "" }), null);
});
