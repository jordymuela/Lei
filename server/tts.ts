// The server's voice: one engine that turns a sentence into audio for the
// page. Kokoro runs right here (an open-source voice; see kokoro.ts);
// ElevenLabs and any local OpenAI-style speech server are proxied, so keys
// never reach the browser. With none of them, the browser speaks with its own voices.

import { existsSync } from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import { KOKORO_FILES, Kokoro, SAMPLE_RATE, type VoiceInfo, encodeWav } from "./kokoro.ts";

export type { VoiceInfo };

export interface VoiceEngine {
  /** Shown next to the voice names, e.g. "Kokoro". */
  name: string;
  /** Never empty. */
  voices: VoiceInfo[];
  /** Audio for one sentence. Rejects if the engine fails. */
  speak(text: string, voice: string, signal: AbortSignal): Promise<Response>;
}

export type EngineName = "kokoro" | "elevenlabs" | "openai";

export const kokoroInstalled = (c: Config) => KOKORO_FILES.every((f) => existsSync(path.join(c.voice.dir, f.name)));

/** Which engine to use: the one LEI_VOICE names if it's set up, else the first that is. Null means browser voices. */
export function chooseEngine(c: Config, kokoroReady: boolean): EngineName | null {
  const ready: Record<EngineName, boolean> = {
    elevenlabs: !!(c.elevenlabs.apiKey && c.elevenlabs.voiceId),
    openai: !!c.voice.url,
    kokoro: kokoroReady,
  };
  const want = c.voice.engine;
  if (want === "browser") return null;
  if (want in ready) return ready[want as EngineName] ? (want as EngineName) : null;
  return (["elevenlabs", "openai", "kokoro"] as const).find((e) => ready[e]) ?? null;
}

/** Sets up the chosen engine; logs why and returns null if it can't. */
export async function createVoice(c: Config): Promise<VoiceEngine | null> {
  const engine = chooseEngine(c, kokoroInstalled(c));
  if (!engine && c.voice.engine !== "auto" && c.voice.engine !== "browser") {
    console.warn(`[voice] LEI_VOICE=${c.voice.engine} isn't set up; using browser voices.`);
  }
  try {
    if (engine === "kokoro") return kokoroVoice(await Kokoro.load(c.voice.dir));
    if (engine === "elevenlabs") return elevenLabsVoice(c);
    if (engine === "openai") return openAiVoice(c);
  } catch (err) {
    console.warn(`[voice] ${engine} didn't load (${err instanceof Error ? err.message : err}); using browser voices.`);
  }
  return null;
}

export function kokoroVoice(kokoro: Pick<Kokoro, "voices" | "synthesize">): VoiceEngine {
  return {
    name: "Kokoro",
    voices: kokoro.voices,
    async speak(text, voice, signal) {
      const audio = await kokoro.synthesize(text, voice, signal);
      return new Response(new Uint8Array(encodeWav(audio, SAMPLE_RATE)), { headers: { "content-type": "audio/wav" } });
    },
  };
}

function elevenLabsVoice(c: Config): VoiceEngine {
  const { apiKey, voiceId, model } = c.elevenlabs;
  return {
    name: "ElevenLabs",
    voices: [{ id: "elevenlabs", label: "ElevenLabs", lang: "" }],
    async speak(text, _voice, signal) {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: model }),
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`ElevenLabs answered ${res.status}`);
      return res;
    },
  };
}

/** Any server with OpenAI's speech endpoint: Kokoro-FastAPI, Chatterbox, Orpheus, LocalAI and others. */
function openAiVoice(c: Config): VoiceEngine {
  const { url, model, apiKey } = c.voice;
  const names = c.voice.voices.split(",").map((v) => v.trim()).filter(Boolean);
  const endpoint = url.replace(/\/+$/, "") + "/audio/speech";
  return {
    name: new URL(url).host,
    voices: (names.length ? names : ["default"]).map((id) => ({ id, label: id, lang: "" })),
    async speak(text, voice, signal) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model, input: text, voice, response_format: "mp3" }),
        signal,
      });
      if (!res.ok || !res.body) throw new Error(`${endpoint} answered ${res.status}`);
      return res;
    },
  };
}
