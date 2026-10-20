import os from "node:os";
import path from "node:path";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** companion: the "Her"-style friend. practice: a speaking partner for learning a language. */
export type Mode = "companion" | "practice";

const env = process.env;
const effort = (env.LEI_EFFORT ?? "low") as Effort;

export const config = {
  mode: (env.LEI_MODE === "practice" ? "practice" : "companion") as Mode,
  practice: {
    /** The learner's own language: the interface and the explanations use it. */
    native: env.LEI_NATIVE_LANG ?? "es-MX",
    /** The language being practised: speech recognition and the voice use it. */
    target: env.LEI_TARGET_LANG ?? "en-US",
  },
  // Companion mode only: read-only looks at this computer, reminders, and web search.
  computer: env.LEI_COMPUTER !== "off",
  web: env.LEI_WEB !== "off",
  /** The folder Lei may look through. */
  workspace: path.resolve(env.LEI_WORKSPACE ?? os.homedir()),
  port: Number(env.PORT ?? 3000),
  // Bound to localhost by default: the server spends your Claude credits for anyone who can reach it.
  host: env.HOST ?? "127.0.0.1",
  model: env.LEI_MODEL ?? "claude-opus-5-5",
  // Low effort keeps the gap between you finishing a sentence and the voice starting short.
  effort: EFFORTS.includes(effort) ? effort : "low",
  dataFile: path.resolve(env.LEI_DATA_FILE ?? "data/state.json"),
  publicDir: path.resolve(import.meta.dirname, "../public"),
  elevenlabs: {
    apiKey: env.ELEVENLABS_API_KEY ?? "",
    voiceId: env.ELEVENLABS_VOICE_ID ?? "",
    model: env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5",
  },
};

export type Config = typeof config;

export const ttsEnabled = (c: Config) => !!(c.elevenlabs.apiKey && c.elevenlabs.voiceId);

/** Server-side refusal fallback is a Claude API feature that Haiku models don't support. */
export const useFallbacks = (model: string) => !/haiku/.test(model);
