import assert from "node:assert/strict";
import { test } from "node:test";
import type { Vad } from "../server/hearing.ts";
import { type HearingEvent, ListenSession } from "../server/listening.ts";
import { PauseStats } from "../public/js/lib/turns.js";

const RATE = 16000;
const CHUNK = 320; // 20 ms, like the page sends

/** Speech is any chunk louder than 0.05; the real VAD is Silero. */
function fakeVad(): Vad {
  let on = false;
  return {
    accept: (s) => (on = s.some((x) => Math.abs(x) > 0.05)),
    speaking: () => on,
    reset: () => (on = false),
  };
}

/**
 * A session whose "recognizer" reveals `script` word by word, one word per
 * 0.25 s of audio heard, the way a real transcript grows.
 */
function session(script: () => string) {
  const events: (HearingEvent & { at: number })[] = [];
  let fed = 0;
  const s = new ListenSession({
    vad: fakeVad(),
    pauses: new PauseStats(),
    transcribe: async (samples) => {
      const w = script().split(" ");
      return w.slice(0, Math.ceil(samples.length / RATE / 0.25)).join(" ");
    },
    send: (e) => events.push({ ...e, at: fed / RATE }),
  });
  const feed = async (seconds: number, speech: boolean) => {
    for (let i = 0; i < (seconds * RATE) / CHUNK; i++) {
      s.audio(new Float32Array(CHUNK).fill(speech ? 0.2 : 0));
      fed += CHUNK;
      await new Promise((r) => setImmediate(r));
    }
  };
  return { s, events, feed, types: () => events.map((e) => e.type + ("on" in e ? (e.on ? "+" : "-") : "")) };
}

test("a finished sentence ends the turn after a short pause", async () => {
  const { events, feed } = session(() => "Book a table for two.");
  await feed(1.5, true);
  await feed(1.5, false);
  const final = events.find((e) => e.type === "final");
  assert.ok(final && final.type === "final");
  assert.equal(final.text, "Book a table for two.");
  // About 0.5 s after they stopped (the wait for a finished sentence), not a fixed 0.9 s.
  assert.ok(final.at > 1.8 && final.at < 2.2, `final at ${final.at}s`);
});

test("'and…' waits longer, and talking again continues the same turn", async () => {
  let script = "I want to go to the beach and";
  const { events, feed } = session(() => script);
  await feed(2, true);
  await feed(1.0, false);
  assert.ok(!events.some((e) => e.type === "final"), "no final after 1 s of 'and…'");
  script = "I want to go to the beach and then get lunch.";
  await feed(1, true);
  await feed(1.5, false);
  const finals = events.filter((e) => e.type === "final");
  assert.equal(finals.length, 1);
  assert.equal(finals[0].type === "final" && finals[0].text, "I want to go to the beach and then get lunch.");
});

test("talking over her ducks her voice, then stops her once they want the floor", async () => {
  const { s, events, feed, types } = session(() => "Wait, actually, not Lisbon.");
  s.control({ type: "speaking", on: true, text: "Here's what I found about flights to Lisbon next week." });
  await feed(0.3, false);
  await feed(1.2, true);
  assert.deepEqual(types().slice(0, 2), ["speech+", "duck+"]);
  assert.ok(types().includes("barge"));
  s.control({ type: "speaking", on: false });
  await feed(1.5, false);
  const final = events.find((e) => e.type === "final");
  assert.equal(final?.type === "final" && final.text, "Wait, actually, not Lisbon.");
});

test("an 'mm-hm' while she talks lets her carry on", async () => {
  const { s, events, feed, types } = session(() => "Mm-hm.");
  s.control({ type: "speaking", on: true, text: "So the first thing to know is the train leaves early." });
  await feed(0.4, true);
  await feed(1.5, false);
  assert.ok(!types().includes("barge"));
  assert.ok(!events.some((e) => e.type === "final"));
  assert.deepEqual(types().filter((t) => t.startsWith("duck")), ["duck+", "duck-"]);
});

test("her own voice leaking into the mic is ignored", async () => {
  const { s, events, feed, types } = session(() => "found the invoice from March it's in your downloads");
  s.control({ type: "speaking", on: true, text: "I found the invoice from March. It's in your downloads folder." });
  await feed(2, true);
  await feed(1.5, false);
  assert.ok(!types().includes("barge"));
  assert.ok(!events.some((e) => e.type === "final"));
});

test("a reply that repeats her words after she has finished is not echo", async () => {
  const { s, events, feed } = session(() => "The invoice from March, yes.");
  s.control({ type: "speaking", on: true, text: "Do you want the invoice from March?" });
  await feed(0.5, false);
  s.control({ type: "speaking", on: false });
  await feed(1, false);
  await feed(1.5, true);
  await feed(1.5, false);
  assert.equal(events.find((e) => e.type === "final")?.type, "final");
});

test("with talking over her turned off, her turn isn't listened to", async () => {
  const { s, events, feed } = session(() => "Wait, stop.");
  s.control({ type: "mode", bargeIn: false });
  s.control({ type: "speaking", on: true, text: "A long story." });
  await feed(1, true);
  await feed(1, false);
  assert.deepEqual(events, []);
});

test("typing instead resets what was being heard", async () => {
  const { s, events, feed } = session(() => "Remind me to");
  await feed(1, true);
  s.control({ type: "reset" });
  await feed(2, false);
  assert.ok(!events.some((e) => e.type === "final"));
});
