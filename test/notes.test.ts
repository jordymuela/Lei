import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSong, noteToMidi, parseNotes, songSeconds } from "../public/js/lib/notes.js";

test("noteToMidi reads pitches with accidentals", () => {
  assert.equal(noteToMidi("A4"), 69);
  assert.equal(noteToMidi("C4"), 60);
  assert.equal(noteToMidi("F#3"), 54);
  assert.equal(noteToMidi("Bb5"), 82);
  assert.equal(noteToMidi("H2"), null);
  assert.equal(noteToMidi("C0"), null);
});

test("parseNotes handles chords, rests and junk", () => {
  assert.deepEqual(parseNotes("C4:1 R:0.5 C4+E4+G4:2 nonsense"), [
    { pitches: [60], beats: 1 },
    { pitches: [], beats: 0.5 },
    { pitches: [60, 64, 67], beats: 2 },
  ]);
  assert.deepEqual(parseNotes("A4"), [{ pitches: [69], beats: 1 }]);
  assert.equal(parseNotes("C4:100")[0].beats, 8);
});

test("normalizeSong rejects melodies with no notes and clamps tempo", () => {
  assert.equal(normalizeSong({ title: "x", melody: "R:1 R:2" }), null);
  const song = normalizeSong({ title: "  Two a.m.  ", tempo: 999, melody: "E4:1 G4:1" });
  assert.deepEqual(song, { title: "Two a.m.", tempo: 160, melody: "E4:1 G4:1", harmony: "" });
  assert.equal(songSeconds({ title: "t", tempo: 60, melody: "C4:1 D4:2", harmony: "C3:4" }), 4);
});
