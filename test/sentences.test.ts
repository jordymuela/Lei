import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceFeed, cutToHeard, lastBoundary, speakable, splitAsides } from "../public/js/lib/sentences.js";

test("lastBoundary finds the end of the last finished sentence", () => {
  assert.equal(lastBoundary("Hello there. How are"), "Hello there. ".length);
  assert.equal(lastBoundary("No end yet"), 0);
  assert.equal(lastBoundary('She said "wow!" and'), 'She said "wow!" '.length);
  assert.equal(lastBoundary("Line one\nLine"), "Line one\n".length);
});

test("SentenceFeed hands out each finished sentence once", () => {
  const feed = new SentenceFeed();
  assert.equal(feed.next("Hi. I'm W"), "Hi. ");
  assert.equal(feed.next("Hi. I'm Wren. How"), "I'm Wren. ");
  assert.equal(feed.next("Hi. I'm Wren. How"), "");
  assert.equal(feed.next("Hi. I'm Wren. How are you", true), "How are you");
  feed.reset();
  assert.equal(feed.next("Again. "), "Again. ");
});

test("speakable strips markdown and emoji", () => {
  assert.equal(speakable("**Hello** _you_ 🎉 there"), "Hello you there");
});

test("bracketed asides are shown but never spoken", () => {
  assert.equal(speakable("Nice try! [Use o passado aqui.] Say it again?"), "Nice try! Say it again?");
  assert.deepEqual(splitAsides("Nice try! [Use o passado.] Again?"), [
    { text: "Nice try! ", aside: false },
    { text: "Use o passado.", aside: true },
    { text: " Again?", aside: false },
  ]);
});

test("SentenceFeed waits for an open aside to close", () => {
  const feed = new SentenceFeed();
  assert.equal(feed.next("Good. [Use o passado. Tente"), "Good. ");
  assert.equal(feed.next("Good. [Use o passado. Tente de novo.] Again? "), "[Use o passado. Tente de novo.] Again? ");
});

test("a long first sentence starts speaking at its last comma; later ones wait for the full stop", () => {
  const feed = new SentenceFeed();
  const reply = "I looked through your downloads folder, and found three invoices from March. The biggest one, from Acme, is due Friday.";
  const chunks: string[] = [];
  for (let i = 1; i <= reply.length; i++) {
    const c = feed.next(reply.slice(0, i));
    if (c) chunks.push(c);
  }
  const rest = feed.next(reply, true);
  if (rest) chunks.push(rest);
  assert.deepEqual(chunks, ["I looked through your downloads folder, ", "and found three invoices from March. ", "The biggest one, from Acme, is due Friday."]);
  // Short first sentences and one-word openers aren't split.
  const short = new SentenceFeed();
  assert.equal(short.next("Okay, so here's the plan"), "");
});

test("an interrupted reply is cut to the words that were heard", () => {
  const reply = "Lisbon is sunny today. There's a light breeze from the ocean.";
  assert.equal(cutToHeard(reply, 23), "Lisbon is sunny today.…");
  assert.equal(cutToHeard(reply, 30), "Lisbon is sunny today. There's…");
  assert.equal(cutToHeard(reply, 27), "Lisbon is sunny today.…");
  assert.equal(cutToHeard(reply, 0), "");
  assert.equal(cutToHeard(reply, reply.length), reply);
  assert.equal(cutToHeard("Sure, let me check", 6), "Sure…");
});
