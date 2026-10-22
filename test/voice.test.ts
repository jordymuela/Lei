import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { config } from "../server/config.ts";
import {
  KOKORO_FILES,
  Kokoro,
  chunkTokens,
  encodeWav,
  fixEnglish,
  fromEspeak,
  normalizeEnglish,
  readNpz,
  splitPunctuation,
  tokenize,
  trimSilence,
} from "../server/kokoro.ts";
import { chooseEngine, kokoroVoice } from "../server/tts.ts";

test("English is normalized the way a person would read it", () => {
  assert.equal(normalizeEnglish("It's 3:30 and I have $5.50."), "It's 3 30 and I have 5 dollars and 50 cents.");
  assert.equal(normalizeEnglish("Dr. Smith said 3.14 in 1990."), "Doctor Smith said 3 point 1 4 in 19 90.");
  assert.equal(normalizeEnglish("Meet at 5:00 (sharp)"), "Meet at 5 o'clock «sharp»");
});

test("punctuation is kept apart so its pauses survive", () => {
  assert.deepEqual(splitPunctuation("Hi, Jordy! Ready?"), [
    { text: "Hi", punctuation: false },
    { text: ", ", punctuation: true },
    { text: "Jordy", punctuation: false },
    { text: "! ", punctuation: true },
    { text: "Ready", punctuation: false },
    { text: "?", punctuation: true },
  ]);
});

test("eSpeak output is mapped to Kokoro's symbols", () => {
  assert.equal(fromEspeak("t^ʃˈa^ɪ (en)wˈiːkɛnd(es) d^ʒo-"), "ʧˈI wˈiːkɛnd ʤo");
  assert.equal(fixEnglish("nˈaɪnti ɹˈʌn ɬ", false), "nˈaɪndi ɹˈʌn l");
  assert.equal(fixEnglish("nˈaɪnti", true), "nˈaɪnti");
});

test("phonemes become token ids, unknown symbols dropped, long input cut at spaces", () => {
  assert.deepEqual(tokenize("hˈi ¿"), [50, 156, 51, 16]);
  const ids = [1, 2, 16, 3, 4, 16, 5, 6];
  assert.deepEqual(chunkTokens(ids, 4), [[1, 2], [3, 4], [5, 6]]);
  assert.deepEqual(chunkTokens([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

/** A tiny .npz like numpy writes: an uncompressed zip of .npy files, with or without Zip64 sizes. */
function npz(entries: Record<string, number[]>, zip64: boolean): Buffer {
  const parts: Buffer[] = [];
  for (const [name, values] of Object.entries(entries)) {
    let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${values.length},), }`;
    header = header.padEnd(118, " ") + "\n";
    const npy = Buffer.concat([Buffer.from("\x93NUMPY\x01\x00", "latin1"), Buffer.alloc(2), Buffer.from(header, "latin1"), Buffer.from(new Float32Array(values).buffer)]);
    npy.writeUInt16LE(header.length, 8);
    const fname = Buffer.from(name + ".npy");
    const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(1, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(npy.length), 4);
      extra.writeBigUInt64LE(BigInt(npy.length), 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(zip64 ? 0xffffffff : npy.length, 18);
    local.writeUInt32LE(zip64 ? 0xffffffff : npy.length, 22);
    local.writeUInt16LE(fname.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, fname, extra, npy);
  }
  parts.push(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  return Buffer.concat(parts);
}

test("voice styles are read from .npz files, Zip64 or not", () => {
  for (const zip64 of [false, true]) {
    const styles = readNpz(npz({ af_heart: [0.5, -1], ef_dora: [2] }, zip64));
    assert.deepEqual([...styles.keys()], ["af_heart", "ef_dora"]);
    assert.deepEqual([...styles.get("af_heart")!], [0.5, -1]);
  }
});

test("long silences around a clip are trimmed to a short pause", () => {
  const rate = 1000;
  const audio = new Float32Array(1000);
  audio.fill(0.5, 300, 500);
  const trimmed = trimSilence(audio, rate, 0.04, 0.12);
  assert.equal(trimmed.length, 40 + 200 + 120);
  assert.equal(trimSilence(new Float32Array(10), rate).length, 0);
});

test("audio is written as 16-bit mono WAV", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]), 24000);
  assert.equal(wav.toString("latin1", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.deepEqual([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48)], [0, 32767, -32767]);
});

test("the engine is the one asked for if it's set up, else the first one that is", () => {
  const c = (voice: Partial<typeof config.voice>, eleven = false) => ({
    ...config,
    voice: { ...config.voice, engine: "auto", url: "", ...voice },
    elevenlabs: { ...config.elevenlabs, apiKey: eleven ? "k" : "", voiceId: eleven ? "v" : "" },
  });
  assert.equal(chooseEngine(c({}), false), null);
  assert.equal(chooseEngine(c({}), true), "kokoro");
  assert.equal(chooseEngine(c({ url: "http://127.0.0.1:8880/v1" }), true), "openai");
  assert.equal(chooseEngine(c({}, true), true), "elevenlabs");
  assert.equal(chooseEngine(c({ engine: "kokoro" }, true), true), "kokoro");
  assert.equal(chooseEngine(c({ engine: "kokoro" }), false), null);
  assert.equal(chooseEngine(c({ engine: "browser" }, true), true), null);
});

test("the Kokoro engine answers with WAV audio", async () => {
  const engine = kokoroVoice({ voices: [{ id: "af_heart", label: "Heart", lang: "en-US" }], synthesize: async () => new Float32Array(240) });
  const res = await engine.speak("Hi.", "af_heart", new AbortController().signal);
  assert.equal(res.headers.get("content-type"), "audio/wav");
  assert.equal((await res.arrayBuffer()).byteLength, 44 + 480);
});

// Runs only where the model has been downloaded (npm run get-voice).
const installed = KOKORO_FILES.every((f) => existsSync(path.join(config.voice.dir, f.name)));
test("the real Kokoro model speaks a sentence", { skip: !installed && "Kokoro isn't downloaded" }, async () => {
  const handlers = process.listeners("uncaughtException").length + process.listeners("unhandledRejection").length;
  const kokoro = await Kokoro.load(config.voice.dir);
  assert.ok(kokoro.voices.some((v) => v.id === "af_heart"));
  assert.match(await kokoro.phonemes("Hi, Jordy.", "af_heart"), /^hˈaɪ, dʒˈoː?ɹdi\.$/);
  const audio = await kokoro.synthesize("Hello there. How was your day?", "af_heart");
  const seconds = audio.length / 24000;
  assert.ok(seconds > 1 && seconds < 4, `${seconds}s`);
  assert.ok(audio.some((s) => Math.abs(s) > 0.1), "not silent");
  // The phonemizer's own crash handlers were removed.
  assert.equal(process.listeners("uncaughtException").length + process.listeners("unhandledRejection").length, handlers);
});
