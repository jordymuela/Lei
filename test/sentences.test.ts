import assert from "node:assert/strict";
import { test } from "node:test";
import { SentenceFeed, lastBoundary, speakable } from "../public/js/lib/sentences.js";

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
