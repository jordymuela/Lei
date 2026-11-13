import assert from "node:assert/strict";
import { test } from "node:test";
import { PauseStats, endOfTurnWait, isBackchannel, isEcho, soundsUnfinished, wantsTheFloor, words } from "../public/js/lib/turns.js";

test("words are lowercased without punctuation, accents folded", () => {
  assert.deepEqual(words("Hey, Lei! It’s café-time?"), ["hey", "lei", "it's", "cafe-time"]);
});

test("unfinished-sounding text gets a long wait, questions a short one", () => {
  assert.ok(soundsUnfinished("I was thinking about the trip and"));
  assert.ok(soundsUnfinished("So, um"));
  assert.ok(soundsUnfinished("Let me see,"));
  assert.ok(!soundsUnfinished("Thank you."));
  assert.equal(endOfTurnWait("I want to go to the", 650), 1430);
  assert.equal(endOfTurnWait("What time is it?", 650), 390);
  assert.equal(endOfTurnWait("Book it.", 650), 488);
  assert.equal(endOfTurnWait("book it", 650), 650);
  assert.equal(endOfTurnWait("Book it.", 400), 350);
});

test("listening noises don't take the turn; 'stop' and real words do", () => {
  for (const t of ["Mm-hm.", "Yeah, okay.", "I see.", "Right right", "uh huh", "Got it."]) assert.ok(isBackchannel(t), t);
  for (const t of ["Yeah, but wait", "I want it", "No.", "Tell me more"]) assert.ok(!isBackchannel(t), t);
  assert.ok(wantsTheFloor("Stop."));
  assert.ok(wantsTheFloor("wait"));
  assert.ok(wantsTheFloor("Actually, no"));
  assert.ok(!wantsTheFloor("Mm-hm."));
  assert.ok(!wantsTheFloor("Yeah, okay."));
  assert.ok(!wantsTheFloor("Um"));
});

test("her own voice coming back through the mic is recognized as echo", () => {
  const spoken = "I found the invoice from March. It's in your downloads folder.";
  assert.ok(isEcho("found the invoice from march", spoken));
  assert.ok(isEcho("in your downloads folder", spoken));
  assert.ok(isEcho("March", spoken));
  assert.ok(!isEcho("no, the one from April", spoken));
  assert.ok(!isEcho("stop", spoken));
  assert.ok(!isEcho("anything", ""));
});

test("the usual pause adapts to how the person talks", () => {
  const stats = new PauseStats();
  assert.equal(stats.typical(), 650);
  for (const ms of [300, 320, 340, 360, 380, 400, 420, 440]) stats.add(ms);
  assert.equal(stats.typical(), 620);
  const slow = new PauseStats();
  for (const ms of [900, 950, 1000, 1100, 1200]) slow.add(ms);
  assert.equal(slow.typical(), 1100);
  slow.add(50);
  slow.add(9000);
  assert.equal(slow.typical(), 1100);
});

test("Smart Turn's verdict from the voice shortens or stretches the wait, but 'and…' still wins", () => {
  assert.equal(endOfTurnWait("Book it.", 650, 0.95), 200);
  assert.equal(endOfTurnWait("book it", 650, 0.6), 300);
  assert.equal(endOfTurnWait("Book it.", 650, 0.05), 1000);
  assert.equal(endOfTurnWait("Book it.", 650, 0.35), 488);
  assert.equal(endOfTurnWait("I want to go to the", 650, 0.95), 1430);
  assert.equal(endOfTurnWait("", 650, 0.95), 650);
});
