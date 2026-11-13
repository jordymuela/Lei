// Local speech recognition, so what you say never leaves the computer:
// - Silero VAD (MIT) notices when someone is speaking.
// - Parakeet TDT 0.6B v3 (NVIDIA, CC-BY-4.0) turns speech into text, with
//   punctuation, in 25 European languages.
// - Smart Turn v3.2 (Pipecat, BSD-2-Clause), if downloaded, judges from the
//   voice whether a pause is the end of the turn (see smartturn.ts).
// The first two run through sherpa-onnx (Apache-2.0), Smart Turn through onnxruntime-node.
// `npm run get-voice` downloads the models; without them the page falls back
// to the browser's speech recognition.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { Config } from "./config.ts";
import { SMART_TURN_FILE, loadSmartTurn } from "./smartturn.ts";

export const HEARING_RATE = 16_000;

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";
export const VAD_FILE = "silero_vad.onnx";
export const PARAKEET_DIR = "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const PARAKEET_FILES = ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"];

export interface ModelFile {
  name: string;
  size: number;
  sha256: string;
  url: string;
  /** A .tar.bz2 unpacked into this folder. */
  unpacksTo?: string;
  /** A zip (here, a Python wheel) from which one file is taken and checked. */
  extract?: { entry: string; to: string; sha256: string };
}

/** What `npm run get-voice` fetches for hearing. */
export const HEARING_FILES: ModelFile[] = [
  { name: VAD_FILE, size: 643_854, sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6", url: RELEASE + VAD_FILE },
  {
    name: PARAKEET_DIR + ".tar.bz2",
    size: 487_211_443,
    sha256: "1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9",
    url: RELEASE + PARAKEET_DIR + ".tar.bz2",
    unpacksTo: PARAKEET_DIR,
  },
  {
    // Pipecat ships the Smart Turn model inside its Python package; only the model is used.
    name: "pipecat_ai-1.16.0-py3-none-any.whl",
    size: 12_374_317,
    sha256: "613604ec4c6bb4301a26004e80011765c1a18d92394994097a65df07fbf1916d",
    url: "https://files.pythonhosted.org/packages/71/67/01f9b6a635a5a517436cfdcb1f1e8fda4e0bc5dd00c111b27e19a757e604/pipecat_ai-1.16.0-py3-none-any.whl",
    extract: {
      entry: "pipecat/audio/turn/smart_turn/data/smart-turn-v3.2-cpu.onnx",
      to: SMART_TURN_FILE,
      sha256: "2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f",
    },
  },
];

export const hearingInstalled = (dir: string) =>
  existsSync(path.join(dir, VAD_FILE)) && PARAKEET_FILES.every((f) => existsSync(path.join(dir, PARAKEET_DIR, f)));

/** Tells whether someone is speaking right now. One per listener: it keeps state. */
export interface Vad {
  accept(samples: Float32Array): void;
  speaking(): boolean;
  reset(): void;
}

export interface Hearing {
  /** Text for 16 kHz mono audio ("" for silence or noise). */
  transcribe(samples: Float32Array): Promise<string>;
  createVad(): Vad;
  /** Smart Turn: probability (0–1) that the speech ending this audio is a finished turn. Absent if not downloaded. */
  finished?(samples: Float32Array): Promise<number>;
}

/** The bits of sherpa-onnx-node used here (it ships no TypeScript types). */
interface Sherpa {
  OfflineRecognizer: {
    createAsync(config: object): Promise<{
      createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void };
      decodeAsync(stream: unknown): Promise<{ text: string }>;
    }>;
  };
  Vad: new (
    config: object,
    bufferSeconds: number,
  ) => { acceptWaveform(s: Float32Array): void; isDetected(): boolean; isEmpty(): boolean; pop(): void; reset(): void };
}

/** Local hearing if it's wanted and downloaded; null (with a reason logged) means the browser listens instead. */
export async function createHearing(c: Config): Promise<Hearing | null> {
  if (c.hearing.engine === "browser") return null;
  if (!hearingInstalled(c.voice.dir)) {
    if (c.hearing.engine === "local") console.warn("[hearing] LEI_HEARING=local, but the models aren't downloaded (npm run get-voice).");
    return null;
  }
  try {
    return await loadHearing(c.voice.dir, { smartTurn: c.hearing.smartTurn });
  } catch (err) {
    console.warn(`[hearing] didn't load (${err instanceof Error ? err.message : err}); the page will use the browser's speech recognition.`);
    return null;
  }
}

/** Loads both models (about 2 s) and warms the recognizer up. */
export async function loadHearing(dir: string, opts: { smartTurn?: boolean } = {}): Promise<Hearing> {
  const sherpa = createRequire(import.meta.url)("sherpa-onnx-node") as Sherpa;
  const model = path.join(dir, PARAKEET_DIR);
  const threads = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: HEARING_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(model, "encoder.int8.onnx"),
        decoder: path.join(model, "decoder.int8.onnx"),
        joiner: path.join(model, "joiner.int8.onnx"),
      },
      tokens: path.join(model, "tokens.txt"),
      modelType: "nemo_transducer",
      numThreads: threads,
      provider: "cpu",
      debug: 0,
    },
  });
  const transcribe = async (samples: Float32Array) => {
    // Under a tenth of a second is a click, not a word.
    if (samples.length < HEARING_RATE / 10) return "";
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples, sampleRate: HEARING_RATE });
    return (await recognizer.decodeAsync(stream)).text.trim();
  };
  await transcribe(new Float32Array(HEARING_RATE));
  const vadModel = path.join(dir, VAD_FILE);
  const smartTurnFile = path.join(dir, SMART_TURN_FILE);
  const smartTurn = opts.smartTurn !== false && existsSync(smartTurnFile)
    ? await loadSmartTurn(smartTurnFile).catch((err) => {
        console.warn(`[hearing] Smart Turn didn't load (${err instanceof Error ? err.message : err}); pauses are judged from the words only.`);
        return null;
      })
    : null;
  return {
    transcribe,
    finished: smartTurn ? (samples) => smartTurn.predict(samples) : undefined,
    createVad() {
      const vad = new sherpa.Vad(
        {
          sileroVad: {
            model: vadModel,
            threshold: 0.5,
            // Report silence quickly; how long a pause ends the turn is decided in listening.ts.
            minSilenceDuration: 0.1,
            minSpeechDuration: 0.1,
            windowSize: 512,
            maxSpeechDuration: 30,
          },
          sampleRate: HEARING_RATE,
          numThreads: 1,
          provider: "cpu",
          debug: 0,
        },
        30,
      );
      return {
        accept(samples) {
          vad.acceptWaveform(samples);
          // Finished segments aren't used (listening.ts keeps its own audio); don't let them pile up.
          while (!vad.isEmpty()) vad.pop();
        },
        speaking: () => vad.isDetected(),
        reset: () => vad.reset(),
      };
    },
  };
}
