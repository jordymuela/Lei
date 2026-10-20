// Turns a reply that is still streaming in into chunks a voice can start
// speaking right away. Shared by the browser; tested from Node.

const BOUNDARY = /[.!?…。！？]+["'”’)\]]*\s+|\n+/g;

/**
 * Index just past the last sentence boundary in `text`, or 0 when no
 * sentence has finished yet.
 * @param {string} text
 * @returns {number}
 */
export function lastBoundary(text) {
  const re = new RegExp(BOUNDARY.source, "g");
  let cut = 0;
  let m;
  while ((m = re.exec(text))) cut = m.index + m[0].length;
  return cut;
}

/**
 * Removes what the voice shouldn't say: [bracketed asides] (practice mode
 * puts help in the learner's own language there; it's shown, not spoken),
 * markdown marks and emoji.
 * @param {string} text
 * @returns {string}
 */
export function speakable(text) {
  return String(text || "")
    .replace(/\[[^\]]*\]?/g, "")
    .replace(/[*_#`~>|]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Remembers how much of a growing reply has already been handed to the voice. */
/**
 * Splits text into plain runs and [bracketed asides] for display, brackets removed.
 * @param {string} text
 * @returns {{ text: string, aside: boolean }[]}
 */
export function splitAsides(text) {
  return String(text || "")
    .split(/(\[[^\]]*\]?)/)
    .filter(Boolean)
    .map((part) => (part.startsWith("[") ? { text: part.replace(/^\[|\]$/g, "").trim(), aside: true } : { text: part, aside: false }))
    .filter((p) => p.text);
}

export class SentenceFeed {
  constructor() {
    this.spoken = 0;
  }

  reset() {
    this.spoken = 0;
  }

  /**
   * Returns the newly finished part of `text` ("" when nothing new is ready).
   * With `final`, returns everything not yet spoken.
   * @param {string} text the whole reply so far
   * @param {boolean} [final]
   * @returns {string}
   */
  next(text, final = false) {
    let rest = text.slice(this.spoken);
    // Never cut inside an [aside] that hasn't closed yet, or half of it would be spoken.
    const open = rest.lastIndexOf("[");
    if (!final && open > rest.lastIndexOf("]")) rest = rest.slice(0, open);
    const cut = final ? rest.length : lastBoundary(rest);
    if (!cut) return "";
    this.spoken += cut;
    return rest.slice(0, cut);
  }
}
