import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatMessage, Correction, Memory, Reminder, State } from "./types.ts";

export const LIMITS = { transcript: 200, memories: 200, corrections: 300, reminders: 100, messageChars: 4000, memoryChars: 240, correctionChars: 300 };

export const emptyState = (): State => ({ profile: null, memories: [], transcript: [], corrections: [], reminders: [] });

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

/**
 * Records a flagged mistake against the user message it belongs to (the
 * latest one). Returns it, or null when it's empty or a repeat for that message.
 */
export function addCorrection(state: State, c: { said: string; better: string; why: string }, now = Date.now()): Correction | null {
  const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, LIMITS.correctionChars);
  const said = clip(c.said), better = clip(c.better), why = clip(c.why);
  if (!said || !better || said === better) return null;
  const forAt = state.transcript.findLast((m) => m.role === "user")?.at ?? now;
  if (state.corrections.some((x) => x.forAt === forAt && x.said === said)) return null;
  const correction = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), said, better, why, at: now, forAt };
  state.corrections.push(correction);
  return correction;
}

function trim(state: State): void {
  if (state.transcript.length > LIMITS.transcript) state.transcript.splice(0, state.transcript.length - LIMITS.transcript);
  if (state.memories.length > LIMITS.memories) state.memories.splice(0, state.memories.length - LIMITS.memories);
  if (state.corrections.length > LIMITS.corrections) state.corrections.splice(0, state.corrections.length - LIMITS.corrections);
  // Drop the oldest finished reminders first; pending ones are never trimmed.
  while (state.reminders.length > LIMITS.reminders) {
    const i = state.reminders.findIndex((r) => r.firedAt && r.delivered);
    if (i < 0) break;
    state.reminders.splice(i, 1);
  }
}

/** A new pending reminder. */
export function addReminder(state: State, text: string, due: number, now = Date.now()): Reminder {
  const reminder: Reminder = { id: "r" + now.toString(36) + Math.random().toString(36).slice(2, 5), text: text.trim().slice(0, 300), due };
  state.reminders.push(reminder);
  return reminder;
}

function normalize(raw: unknown): State {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<State>;
  return {
    profile: s.profile && s.profile.companionName ? s.profile : null,
    memories: Array.isArray(s.memories) ? s.memories : [],
    transcript: Array.isArray(s.transcript) ? s.transcript : [],
    corrections: Array.isArray(s.corrections) ? s.corrections : [],
    reminders: Array.isArray(s.reminders) ? s.reminders : [],
  };
}
