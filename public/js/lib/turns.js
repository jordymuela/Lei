// Turn-taking rules: how long to wait before deciding the person has
// finished, which sounds are only "mm-hm"s, and which heard words are just
// her own voice coming back through the speakers. Shared by the server's
// local hearing and the browser's speech recognition; tested from Node.

/** Words that usually mean the sentence isn't over yet. */
const CONTINUES = new Set([
  "and", "but", "or", "so", "because", "cause", "um", "umm", "uh", "uhh", "er", "erm", "like", "the", "a", "an",
  "to", "of", "with", "for", "that", "if", "when", "then", "my", "your", "our", "their", "i", "i'm", "we're",
  "it's", "there's", "just", "also", "actually", "about", "from", "into", "than",
]);

/** Sounds that are never words of their own. */
const NOISES = new Set(["mm", "mmm", "mhm", "mm-hm", "mm-hmm", "hm", "hmm", "uh", "uhh", "um", "umm", "er", "erm", "ah", "oh", "uh-huh"]);

/** Single words people say to show they're listening, not to take the turn. */
const LISTENING = new Set([...NOISES, "yeah", "yep", "yes", "ok", "okay", "right", "sure", "wow", "nice", "cool", "true", "exactly", "totally", "alright", "aha"]);
const LISTENING_PHRASES = new Set(["i see", "got it", "all right", "uh huh", "mm hm", "fair enough", "makes sense", "i know", "of course"]);

/** Words that stop her on their own. */
const STOP = /\b(stop|wait|hold on|hang on|sorry|excuse me|pause|enough|never ?mind|no no)\b/;

/**
 * Lowercase words without punctuation (apostrophes and inner hyphens kept).
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
      ?.map((w) => w.replace(/’/g, "'")) ?? []
  );
}

/**
 * True when the text sounds unfinished: a trailing "and", "um", comma, dash or ellipsis.
 * @param {string} text
 */
export function soundsUnfinished(text) {
  const t = text.trim();
  if (/(,|-|—|…|\.\.\.)$/.test(t)) return true;
  const last = words(t).at(-1);
  return !!last && CONTINUES.has(last);
}

/**
 * Only listening noises ("mm-hm", "yeah", "okay", "I see"), not an attempt to speak.
 * @param {string} text
 */
export function isBackchannel(text) {
  const w = words(text);
  if (!w.length) return false;
  return LISTENING_PHRASES.has(w.join(" ")) || (w.length <= 3 && w.every((x) => LISTENING.has(x)));
}

/**
 * Words that count toward taking the turn: everything but "um" and "mm".
 * @param {string} text
 */
export function meaningfulWords(text) {
  return words(text).filter((w) => !NOISES.has(w));
}

/**
 * True when what they've said so far means they want to speak: "stop", "wait", or two real words that aren't just "yeah, okay".
 * @param {string} text
 */
export function wantsTheFloor(text) {
  if (STOP.test(words(text).join(" "))) return true;
  return meaningfulWords(text).length >= 2 && !isBackchannel(text);
}

/** @param {string[]} w */
const pairs = (w) => w.slice(1).map((x, i) => w[i] + " " + x);

/**
 * True when what was heard is mostly her own recent speech leaking back into
 * the mic (echo cancellation isn't perfect, and some browsers don't cancel
 * page audio at all). Longer phrases are matched by word pairs, short ones by words.
 * @param {string} heard
 * @param {string} spoken
 */
export function isEcho(heard, spoken) {
  const h = words(heard);
  const s = words(spoken);
  if (!h.length || !s.length) return false;
  if (h.length < 3) return h.every((w) => s.includes(w));
  const said = new Set(pairs(s));
  const hp = pairs(h);
  return hp.filter((p) => said.has(p)).length / hp.length >= 0.5;
}

/** The person's own pauses mid-sentence, so the wait fits how they talk. */
export class PauseStats {
  /** @type {number[]} */
  #pauses = [];

  /**
   * A pause (ms) after which they kept talking.
   * @param {number} ms
   */
  add(ms) {
    if (ms < 120 || ms > 3000) return;
    this.#pauses.push(ms);
    if (this.#pauses.length > 60) this.#pauses.shift();
  }

  /** How long they usually pause without being done: about their 75th percentile plus a margin. */
  typical() {
    if (this.#pauses.length < 5) return 650;
    const sorted = [...this.#pauses].sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    return Math.min(1100, Math.max(450, p75 + 200));
  }
}

/**
 * How long (ms) to wait in silence before treating `text` as the end of the
 * person's turn: short after a question or a finished sentence, long after
 * "and…" or "um", and otherwise their usual pause.
 * @param {string} text
 * @param {number} [typical]
 */
export function endOfTurnWait(text, typical = 650) {
  const t = text.trim();
  if (!t) return typical;
  if (soundsUnfinished(t)) return Math.min(2500, Math.max(1200, Math.round(typical * 2.2)));
  if (t.endsWith("?")) return Math.max(300, Math.round(typical * 0.6));
  if (/[.!]$/.test(t)) return Math.max(350, Math.round(typical * 0.75));
  return typical;
}
