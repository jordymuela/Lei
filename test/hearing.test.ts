import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { config } from "../server/config.ts";
import { hearingInstalled, loadHearing } from "../server/hearing.ts";
import { KOKORO_FILES, Kokoro } from "../server/kokoro.ts";
import { SMART_TURN_FILE, loadSmartTurn } from "../server/smartturn.ts";

// Runs only where the models have been downloaded (npm run get-voice). Kokoro
// makes the speech, so this also checks that the two understand each other.
const ready = hearingInstalled(config.voice.dir) && KOKORO_FILES.every((f) => existsSync(path.join(config.voice.dir, f.name)));

/** Kokoro's 24 kHz to the recognizer's 16 kHz. */
function to16k(a: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor((a.length * 2) / 3));
  for (let i = 0; i < out.length; i++) {
    const x = i * 1.5;
    const j = Math.floor(x);
    out[i] = (a[j] ?? 0) * (1 - (x - j)) + (a[j + 1] ?? 0) * (x - j);
  }
  return out;
}

test("the local recognizer hears what Kokoro says, and the VAD notices it", { skip: !ready && "models aren't downloaded" }, async () => {
  const [hearing, kokoro] = await Promise.all([loadHearing(config.voice.dir), Kokoro.load(config.voice.dir)]);
  const speech = to16k(await kokoro.synthesize("Good morning. Can you remind me to call my sister at six?", "am_michael"));
  const text = await hearing.transcribe(speech);
  assert.match(text, /good morning/i);
  assert.match(text, /remind me to call my sister at (six|6)/i);
  assert.equal(await hearing.transcribe(new Float32Array(800)), "");

  const vad = hearing.createVad();
  let heardSpeech = false;
  for (let i = 0; i < speech.length; i += 640) {
    vad.accept(speech.subarray(i, i + 640));
    heardSpeech ||= vad.speaking();
  }
  assert.ok(heardSpeech, "speech detected");
  for (let i = 0; i < 16000; i += 640) vad.accept(new Float32Array(640));
  assert.ok(!vad.speaking(), "silence after it");
});

test("Smart Turn hears a finished question as done and a trailing 'and' as not", { skip: !(ready && existsSync(path.join(config.voice.dir, SMART_TURN_FILE))) && "models aren't downloaded" }, async () => {
  const [smartTurn, kokoro] = await Promise.all([loadSmartTurn(path.join(config.voice.dir, SMART_TURN_FILE)), Kokoro.load(config.voice.dir)]);
  const done = await smartTurn.predict(to16k(await kokoro.synthesize("What's the weather like in Lisbon today?", "am_michael")));
  const trailing = await smartTurn.predict(to16k(await kokoro.synthesize("I was thinking we could go to the beach and", "am_michael")));
  assert.ok(done > 0.8, `done ${done}`);
  assert.ok(trailing < 0.2, `trailing ${trailing}`);
});
