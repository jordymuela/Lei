import type Anthropic from "@anthropic-ai/sdk";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { echoable, runTurn } from "../server/chat.ts";
import { config } from "../server/config.ts";
import { Store, addMessage } from "../server/store.ts";
import type { Correction, Memory, Song } from "../server/types.ts";

type Block = Anthropic.Beta.BetaContentBlock;

/** One scripted model round: the text it streams and the final message it ends with. */
interface Round {
  text?: string[];
  content: unknown[];
  stop_reason: string;
}

/** A stand-in for the SDK client that replays scripted rounds and records each request. */
function fakeClient(rounds: Round[]) {
  const requests: any[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: any) {
          // The request is mutated after each round; keep a snapshot.
          requests.push(structuredClone(params));
          const round = rounds.shift();
          if (!round) throw new Error("unexpected extra round");
          let onText: (d: string) => void = () => {};
          return {
            on(event: string, cb: (d: string) => void) {
              if (event === "text") onText = cb;
            },
            async finalMessage() {
              for (const d of round.text ?? []) onText(d);
              return { content: round.content, stop_reason: round.stop_reason };
            },
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, requests };
}

async function storeWithProfile() {
  const store = new Store(path.join(await mkdtemp(path.join(tmpdir(), "lei-")), "state.json"));
  await store.update((s) => {
    s.profile = { userName: "Theo", about: "", onMind: "", companionName: "Wren", createdAt: 0 };
    addMessage(s, { role: "assistant", text: "Hi Theo.", at: 1 });
    addMessage(s, { role: "user", text: "Play me something? My sister Ana moved to Lisbon.", at: 2 });
  });
  return store;
}

function collect() {
  const deltas: string[] = [];
  const memories: Memory[] = [];
  const songs: Song[] = [];
  const corrections: Correction[] = [];
  return {
    deltas,
    memories,
    songs,
    corrections,
    on: {
      text: (d: string) => deltas.push(d),
      memory: (m: Memory) => memories.push(m),
      song: (s: Song) => songs.push(s),
      correction: (c: Correction) => corrections.push(c),
    },
  };
}

test("a plain reply streams its text and ends", async () => {
  const { client, requests } = fakeClient([
    { text: ["Hello ", "again."], content: [{ type: "text", text: "Hello again." }], stop_reason: "end_turn" },
  ]);
  const got = collect();
  const result = await runTurn({ client, config, store: await storeWithProfile(), signal: new AbortController().signal, on: got.on });
  assert.deepEqual(result, { text: "Hello again.", song: undefined, end: "done" });
  assert.equal(got.deltas.join(""), "Hello again.");
  assert.equal(requests[0].messages.at(-1).role, "user");
  assert.equal(requests[0].system.length, 2);
});

test("tool calls are run, saved, and answered before the reply continues", async () => {
  const { client, requests } = fakeClient([
    {
      text: ["Oh, Lisbon."],
      content: [
        { type: "text", text: "Oh, Lisbon." },
        { type: "tool_use", id: "t1", name: "remember", input: { fact: "Sister Ana moved to Lisbon." } },
        { type: "tool_use", id: "t2", name: "compose", input: { title: "Tram 28", tempo: 60, melody: "E4:1 G4:1" } },
      ],
      stop_reason: "tool_use",
    },
    { text: ["This one's for her."], content: [{ type: "text", text: "This one's for her." }], stop_reason: "end_turn" },
  ]);
  const store = await storeWithProfile();
  const got = collect();
  const result = await runTurn({ client, config, store, signal: new AbortController().signal, on: got.on });

  assert.equal(result.text, "Oh, Lisbon.\n\nThis one's for her.");
  assert.equal(result.song?.title, "Tram 28");
  assert.equal(got.memories[0].text, "Sister Ana moved to Lisbon.");
  assert.equal((await store.load()).memories.length, 1);

  const toolResults = requests[1].messages.at(-1).content;
  assert.deepEqual(
    toolResults.map((r: any) => [r.tool_use_id, r.is_error]),
    [["t1", false], ["t2", false]],
  );
});

test("a duplicate memory comes back to Claude as an error result", async () => {
  const call = { type: "tool_use", id: "t1", name: "remember", input: { fact: "Likes tea." } };
  const { client, requests } = fakeClient([
    { content: [call], stop_reason: "tool_use" },
    { content: [{ ...call, id: "t2" }], stop_reason: "tool_use" },
    { text: ["Noted."], content: [{ type: "text", text: "Noted." }], stop_reason: "end_turn" },
  ]);
  await runTurn({ client, config, store: await storeWithProfile(), signal: new AbortController().signal, on: collect().on });
  assert.equal(requests[2].messages.at(-1).content[0].is_error, true);
});

test("a refusal drops the text", async () => {
  const { client } = fakeClient([{ text: ["Well"], content: [], stop_reason: "refusal" }]);
  const result = await runTurn({ client, config, store: await storeWithProfile(), signal: new AbortController().signal, on: collect().on });
  assert.deepEqual(result, { text: "", end: "refused" });
});

test("tools cut off by max_tokens are never run", async () => {
  const { client } = fakeClient([
    { content: [{ type: "tool_use", id: "t1", name: "remember", input: { fact: "Half a fa" } }], stop_reason: "max_tokens" },
  ]);
  const store = await storeWithProfile();
  const result = await runTurn({ client, config, store, signal: new AbortController().signal, on: collect().on });
  assert.equal(result.end, "truncated");
  assert.equal((await store.load()).memories.length, 0);
});

test("after a mid-reply fallback, only text from the declined model is echoed", () => {
  const content = [
    { type: "thinking", thinking: "", signature: "x" },
    { type: "text", text: "Partial" },
    { type: "tool_use", id: "old", name: "remember", input: {} },
    { type: "fallback" },
    { type: "text", text: " continued" },
    { type: "tool_use", id: "new", name: "remember", input: {} },
  ] as unknown as Block[];
  assert.deepEqual(
    echoable(content).map((b: any) => b.id ?? b.type),
    ["text", "fallback", "text", "new"],
  );
  const plain = [{ type: "text", text: "hi" }] as unknown as Block[];
  assert.equal(echoable(plain), plain);
});

test("practice mode uses the tutor persona, offers correct, and saves corrections", async () => {
  const { client, requests } = fakeClient([
    {
      content: [{ type: "tool_use", id: "c1", name: "correct", input: { said: "My sister moved", better: "My sister has moved", why: "Present perfect." } }],
      stop_reason: "tool_use",
    },
    { text: ["Lisbon is lovely!"], content: [{ type: "text", text: "Lisbon is lovely!" }], stop_reason: "end_turn" },
  ]);
  const store = await storeWithProfile();
  const got = collect();
  const practiceConfig = { ...config, mode: "practice" as const };
  await runTurn({ client, config: practiceConfig, store, signal: new AbortController().signal, on: got.on });
  assert.match(requests[0].system[0].text, /speaking-practice app/);
  assert.deepEqual(requests[0].tools.map((t: any) => t.name), ["remember", "correct"]);
  assert.equal(got.corrections[0].better, "My sister has moved");
  assert.equal((await store.load()).corrections[0].forAt, 2);
});
