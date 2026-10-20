import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceFeed, lastBoundary, speakable, splitAsides } from "../public/js/lib/sentences.js";

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
