// The tiny score format the companion composes in, e.g. "E4:1 G4:0.5 R:0.5 C4+E4+G4:2".
// Each token is NOTE:BEATS; NOTE is a pitch (C4, F#3, Bb5), several pitches
// joined with "+" for a chord, or R for a rest. The server validates songs with
// this module and the browser plays them with it.

const MAX_TOKENS = 96;
const MAX_CHORD = 4;

/**
 * @typedef {{ pitches: number[], beats: number }} NoteEvent
 * @typedef {{ title: string, tempo: number, melody: string, harmony: string }} Song
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * MIDI note number for a pitch like "C4", "F#3" or "Bb5"; null if unreadable
 * or outside the piano's comfortable range.
 * @param {string} name
 * @returns {number | null}
 */
export function noteToMidi(name) {
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(String(name).trim());
  if (!m) return null;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  const n = 12 * (parseInt(m[3], 10) + 1) + base + acc;
  return n < 24 || n > 108 ? null : n;
}

/**
 * Parses a score string. Unreadable tokens are skipped.
 * @param {string} score
 * @returns {NoteEvent[]}
 */
export function parseNotes(score) {
  /** @type {NoteEvent[]} */
  const out = [];
  for (const tok of String(score || "").trim().split(/[\s,]+/).slice(0, MAX_TOKENS)) {
    if (!tok) continue;
    const [p, b] = tok.split(":");
    const beats = clamp(parseFloat(b) || 1, 0.125, 8);
    if (/^r(est)?$/i.test(p)) {
      out.push({ pitches: [], beats });
      continue;
    }
    const pitches = p
      .split("+")
      .map(noteToMidi)
      .filter((n) => n != null)
      .slice(0, MAX_CHORD);
    if (pitches.length) out.push({ pitches: /** @type {number[]} */ (pitches), beats });
  }
  return out;
}

/**
 * Builds a playable song from the companion's tool input, or null when the
 * melody has no playable notes.
 * @param {Record<string, unknown>} input
 * @returns {Song | null}
 */
export function normalizeSong(input) {
  const melody = typeof input.melody === "string" ? input.melody : "";
  if (!parseNotes(melody).some((e) => e.pitches.length)) return null;
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 60) : "";
  return {
    title: title || "Untitled",
    tempo: clamp(Number(input.tempo) || 80, 40, 160),
    melody,
    harmony: typeof input.harmony === "string" ? input.harmony : "",
  };
}

/**
 * Length of a song in seconds.
 * @param {Song} song
 * @returns {number}
 */
export function songSeconds(song) {
  const beats = (s) => parseNotes(s).reduce((sum, e) => sum + e.beats, 0);
  return Math.max(beats(song.melody), beats(song.harmony)) * (60 / song.tempo);
}
