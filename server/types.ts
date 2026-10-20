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

export interface Profile {
  userName: string;
  about: string;
  onMind: string;
  companionName: string;
  createdAt: number;
}

/** Everything Lei keeps between runs. One person per install. */
export interface State {
  profile: Profile | null;
  memories: Memory[];
  transcript: ChatMessage[];
}

/** Lines streamed to the browser from POST /api/chat, one JSON object per line. */
export type ChatEvent =
  | { type: "text"; delta: string }
  | { type: "memory"; memory: Memory }
  | { type: "song"; song: Song }
  | { type: "done"; message: ChatMessage | null }
  | { type: "error"; code: string; message: string };
