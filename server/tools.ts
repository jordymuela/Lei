import type Anthropic from "@anthropic-ai/sdk";
import { normalizeSong, songSeconds } from "../public/js/lib/notes.js";
import type { Mode } from "./config.ts";
import type { Song } from "./types.ts";

// Inputs stream in as they're written (eager_input_streaming), so the API no
// longer validates them against the schema; runTool checks every field itself.

const REMEMBER: Anthropic.Beta.BetaTool = {
  name: "remember",
  description:
    'Save one short, lasting fact about the person (third person, under 25 words) so you remember it in future conversations. Returns "saved".',
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      fact: { type: "string", description: 'For example: "Their sister Ana just moved to Lisbon."' },
    },
    required: ["fact"],
  },
};

const COMPOSE: Anthropic.Beta.BetaTool = {
  name: "compose",
  description:
    "Compose a short piano piece that captures this moment. The app plays it right after you finish talking. Returns its length in seconds.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short, evocative title." },
      tempo: { type: "number", description: "Beats per minute, 50 to 140." },
      melody: {
        type: "string",
        description:
          '8 to 40 space-separated NOTE:BEATS tokens. NOTE is a pitch from C3 to C6 such as C4, F#4 or Bb3, several pitches joined with + for a chord (C4+E4+G4), or R for a rest. Example: "E4:1 G4:0.5 A4:0.5 B4:1.5 R:0.5 A4+C5:2"',
      },
      harmony: {
        type: "string",
        description: "Optional softer accompaniment in the same format, usually low chords or bass notes that last as long as the melody.",
      },
    },
    required: ["title", "melody"],
  },
};

const CORRECT: Anthropic.Beta.BetaTool = {
  name: "correct",
  description:
    "Show the learner one correction for their last message: what they said, a better way to say it, and a very short explanation in their own language. The app shows it as a card under their message and saves it for review. Returns \"shown\".",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      said: { type: "string", description: "The words they used, quoted from their message." },
      better: { type: "string", description: "A natural, correct way to say it in the language they're practising." },
      why: { type: "string", description: "One short sentence in the learner's own language explaining the change." },
    },
    required: ["said", "better", "why"],
  },
};

/** The tools Claude gets in each mode. */
export function toolsFor(mode: Mode): Anthropic.Beta.BetaTool[] {
  return mode === "practice" ? [REMEMBER, CORRECT] : [REMEMBER, COMPOSE];
}

/** What running a tool produced: the result Claude reads, plus any effect for the app to apply. */
export interface ToolOutcome {
  result: string;
  isError: boolean;
  fact?: string;
  song?: Song;
  correction?: { said: string; better: string; why: string };
}

const fail = (result: string): ToolOutcome => ({ result, isError: true });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Validates and runs one tool call. Saving memories and corrections is left
 * to the caller (chat.ts), which owns the store; a duplicate comes back as an
 * error result there.
 */
export function runTool(name: string, input: unknown): ToolOutcome {
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!args) return fail("Error: input must be an object.");
  switch (name) {
    case "remember": {
      if (!text(args.fact)) return fail('Error: "fact" must be a non-empty string.');
      return { result: "saved", isError: false, fact: text(args.fact) };
    }
    case "compose": {
      const song = normalizeSong(args);
      if (!song) return fail('Error: couldn\'t read the notes. Use NOTE:BEATS tokens like "E4:1 G4:0.5 R:0.5 C5+E5:2".');
      return { result: JSON.stringify({ ok: true, seconds: Math.round(songSeconds(song)) }), isError: false, song };
    }
    case "correct": {
      const said = text(args.said), better = text(args.better), why = text(args.why);
      if (!said || !better) return fail('Error: "said" and "better" must be non-empty strings.');
      if (said === better) return fail('Error: "better" is the same as "said"; nothing to correct.');
      return { result: "shown", isError: false, correction: { said, better, why } };
    }
    default:
      return fail(`Error: unknown tool "${name}".`);
  }
}
