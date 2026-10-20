import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, Memory, State } from "./types.ts";

export const LIMITS = { transcript: 200, memories: 200, messageChars: 4000, memoryChars: 240 };

export const emptyState = (): State => ({ profile: null, memories: [], transcript: [] });

/**
 * The whole state lives in one JSON file. Every change goes through
 * `update()`, which applies it in memory and then writes the file atomically
 * (temp file + rename), one write at a time.
 */
export class Store {
  #file: string;
  #state: State | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<State> {
    if (this.#state) return this.#state;
    try {
      this.#state = normalize(JSON.parse(await readFile(this.#file, "utf8")));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.#state = emptyState();
    }
    return this.#state;
  }

  async update(change: (state: State) => void): Promise<State> {
    const state = await this.load();
    change(state);
    trim(state);
    await this.#persist(state);
    return state;
  }

  async reset(): Promise<State> {
    this.#state = emptyState();
    this.#writes = this.#writes.catch(() => {}).then(() => rm(this.#file, { force: true }));
    await this.#writes;
    return this.#state;
  }

  #persist(state: State): Promise<void> {
    const data = JSON.stringify(state, null, 2);
    const file = this.#file;
    this.#writes = this.#writes
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file + ".tmp", data);
        await rename(file + ".tmp", file);
      });
    return this.#writes;
  }
}

/** Adds a memory unless the same text is already saved. Returns it, or null for a duplicate or empty fact. */
export function addMemory(state: State, raw: string, now = Date.now()): Memory | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, LIMITS.memoryChars);
  if (!text) return null;
  if (state.memories.some((m) => m.text.toLowerCase() === text.toLowerCase())) return null;
  const memory = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), text, at: now };
  state.memories.push(memory);
  return memory;
}

export function addMessage(state: State, message: ChatMessage): void {
  state.transcript.push({ ...message, text: message.text.slice(0, LIMITS.messageChars) });
}

function trim(state: State): void {
  if (state.transcript.length > LIMITS.transcript) state.transcript.splice(0, state.transcript.length - LIMITS.transcript);
  if (state.memories.length > LIMITS.memories) state.memories.splice(0, state.memories.length - LIMITS.memories);
}

function normalize(raw: unknown): State {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<State>;
  return {
    profile: s.profile && s.profile.companionName ? s.profile : null,
    memories: Array.isArray(s.memories) ? s.memories : [],
    transcript: Array.isArray(s.transcript) ? s.transcript : [],
  };
}
