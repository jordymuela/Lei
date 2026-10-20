import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanName, contextPrompt, historyMessages, personaPrompt } from "../server/prompt.ts";
import type { State } from "../server/types.ts";

const profile = { userName: "Theo", about: "letter writer", onMind: "my sister moving", companionName: "Wren", createdAt: 0 };

test("history starts with a user turn even though the transcript opens with the greeting", () => {
  const state: State = {
    profile,
    memories: [],
    transcript: [
      { role: "assistant", text: "Hi Theo, I'm Wren.", at: 1 },
      { role: "user", text: "hey", at: 2 },
      { role: "assistant", text: "", at: 3, song: { title: "Rain", tempo: 70, melody: "C4:1", harmony: "" } },
    ],
  };
  const msgs = historyMessages(state);
  assert.equal(msgs[0].role, "user");
  assert.equal(msgs[1].content, "Hi Theo, I'm Wren.");
  assert.match(String(msgs[3].content), /You played a piece you composed, "Rain"/);
});

test("history keeps only the most recent turns", () => {
  const transcript = Array.from({ length: 50 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", text: "m" + i, at: i }));
  const msgs = historyMessages({ profile, memories: [], transcript }, 10);
  assert.equal(msgs.length, 10);
  assert.equal(msgs[9].content, "m49");
});

test("context mentions notes and a long gap", () => {
  const hour = 3600e3;
  const state: State = {
    profile,
    memories: [{ id: "a", text: "Sister Ana moved to Lisbon.", at: 0 }],
    transcript: [
      { role: "assistant", text: "Night.", at: 0 },
      { role: "user", text: "Morning!", at: 9 * hour },
    ],
  };
  const ctx = contextPrompt(state, new Date(9 * hour));
  assert.match(ctx, /- Sister Ana moved to Lisbon\./);
  assert.match(ctx, /coming back after 9 hours away/);
});

test("persona is stable for a profile, so it can be cached", () => {
  assert.equal(personaPrompt(profile), personaPrompt({ ...profile }));
  assert.doesNotMatch(personaPrompt(profile), /\d{1,2}:\d{2}/);
});

test("cleanName keeps one capitalized word", () => {
  assert.equal(cleanName("wren"), "Wren");
  assert.equal(cleanName("Sol, of course"), "Sol");
  assert.equal(cleanName("🙂"), "");
  assert.equal(cleanName(undefined), "");
});
