export interface Song {
  title: string;
  tempo: number;
  melody: string;
  harmony: string;
}

export interface Memory {
  id: string;
  text: string;
  at: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  song?: Song;
}

/** A mistake the tutor flagged in practice mode, tied to the user message it came from. */
export interface Correction {
  id: string;
  said: string;
  better: string;
  /** Short explanation in the learner's own language. */
  why: string;
  at: number;
  /** `at` of the user message being corrected. */
  forAt: number;
}

export interface Profile {
  userName: string;
  about: string;
  onMind: string;
  companionName: string;
  createdAt: number;
  /** Practice mode only: "beginner" | "intermediate" | "advanced". */
  level?: string;
  /** Practice mode only: what they want the language for. */
  goal?: string;
}

/** Everything Lei keeps between runs. One person per install. */
export interface State {
  profile: Profile | null;
  memories: Memory[];
  transcript: ChatMessage[];
  corrections: Correction[];
}

/** Lines streamed to the browser from POST /api/chat, one JSON object per line. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "memory"; memory: Memory }
  | { type: "song"; song: Song }
  | { type: "correction"; correction: Correction }
  | { type: "done"; message: ChatMessage | null }
  | { type: "error"; code: string; message: string };
