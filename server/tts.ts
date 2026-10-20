import type { ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Config } from "./config.ts";

/**
 * Proxies one sentence to ElevenLabs and streams the MP3 back, so the API
 * key never reaches the browser. Only used when ELEVENLABS_API_KEY and
 * ELEVENLABS_VOICE_ID are set; otherwise the browser speaks with its own voices.
 */
export async function speak(config: Config, text: string, res: ServerResponse, signal: AbortSignal): Promise<void> {
  const { apiKey, voiceId, model } = config.elevenlabs;
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
      signal,
    },
  );
  if (!upstream.ok || !upstream.body) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "tts_failed", status: upstream.status }));
    return;
  }
  res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
  Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
}
