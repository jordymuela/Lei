// Kokoro-82M, an open-source voice (Apache-2.0, by hexgrad), run inside this
// server with onnxruntime-node: it sounds human, needs no GPU, no Python and
// no account, and nothing she says leaves the computer. The model files are
// the kokoro-onnx release on GitHub; `npm run get-voice` downloads them and
// checks them against the hashes below.
//
// Text becomes phonemes the way the reference ports do it:
// - English: the `phonemizer` package (eSpeak NG as WebAssembly), with
//   kokoro-js's text clean-up and fixes (Apache-2.0).
// - Spanish and Brazilian Portuguese: the `espeak-ng` program, if installed,
//   mapped to Kokoro's symbols the way misaki's EspeakG2P does.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InferenceSession } from "onnxruntime-node";

export const SAMPLE_RATE = 24_000;
/** Most tokens the model takes at once; longer text is spoken in pieces. */
const MAX_TOKENS = 510;
const STYLE_SIZE = 256;

const RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/";
export const MODEL_FILE = "kokoro-v1.0.onnx";
export const VOICES_FILE = "voices-v1.0.bin";
export const KOKORO_FILES = [
  { name: MODEL_FILE, size: 325_532_387, sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5" },
  { name: VOICES_FILE, size: 28_214_398, sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d" },
].map((f) => ({ ...f, url: RELEASE + f.name }));

export interface VoiceInfo {
  id: string;
  label: string;
  /** BCP 47 language, or "" for a voice that speaks any language. */
  lang: string;
}

/** The voices worth offering, best first (grades from Kokoro's VOICES.md). The id's first letter is the language, the second f/m. */
export const KOKORO_VOICES: VoiceInfo[] = [
  { id: "af_heart", label: "Heart", lang: "en-US" },
  { id: "af_bella", label: "Bella", lang: "en-US" },
  { id: "bf_emma", label: "Emma", lang: "en-GB" },
  { id: "af_nicole", label: "Nicole", lang: "en-US" },
  { id: "am_michael", label: "Michael", lang: "en-US" },
  { id: "af_aoede", label: "Aoede", lang: "en-US" },
  { id: "af_kore", label: "Kore", lang: "en-US" },
  { id: "af_sarah", label: "Sarah", lang: "en-US" },
  { id: "am_fenrir", label: "Fenrir", lang: "en-US" },
  { id: "am_puck", label: "Puck", lang: "en-US" },
  { id: "bf_isabella", label: "Isabella", lang: "en-GB" },
  { id: "bm_george", label: "George", lang: "en-GB" },
  { id: "bm_fable", label: "Fable", lang: "en-GB" },
  { id: "ef_dora", label: "Dora", lang: "es" },
  { id: "em_alex", label: "Alex", lang: "es" },
  { id: "pf_dora", label: "Dora", lang: "pt-BR" },
  { id: "pm_alex", label: "Alex", lang: "pt-BR" },
];

/** eSpeak language for each voice family (the id's first letter). */
const ESPEAK_LANG: Record<string, string> = { a: "en-us", b: "en-gb", e: "es", p: "pt-br" };

/** Kokoro's phoneme symbols and their token ids (from the model's config.json). */
const VOCAB: Record<string, number> = {";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"̃":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};
const SPACE = VOCAB[" "];

/* ---------- Text to phonemes ---------- */

/** "1990" -> "19 90", "3:05" -> "3 oh 5", "3:00" -> "3 o'clock". */
function splitNumber(s: string): string {
  if (s.includes(".")) return s;
  if (s.includes(":")) {
    const [h, m] = s.split(":").map(Number);
    return m === 0 ? `${h} o'clock` : m < 10 ? `${h} oh ${m}` : `${h} ${m}`;
  }
  const year = parseInt(s.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return s;
  const left = s.slice(0, 2);
  const right = parseInt(s.slice(2, 4), 10);
  const plural = s.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${plural}`;
    if (right < 10) return `${left} oh ${right}${plural}`;
  }
  return `${left} ${right}${plural}`;
}

/** "$5.50" -> "5 dollars and 50 cents". */
function sayMoney(m: string): string {
  const unit = m[0] === "$" ? "dollar" : "pound";
  const amount = m.slice(1);
  if (isNaN(Number(amount))) return `${amount} ${unit}s`;
  if (!amount.includes(".")) return `${amount} ${unit}${amount === "1" ? "" : "s"}`;
  const [whole, part] = amount.split(".");
  const cents = parseInt(part.padEnd(2, "0"), 10);
  const coin = m[0] === "$" ? (cents === 1 ? "cent" : "cents") : cents === 1 ? "penny" : "pence";
  return `${whole} ${unit}${whole === "1" ? "" : "s"} and ${cents} ${coin}`;
}

/** "3.14" -> "3 point 1 4". */
function sayDecimal(m: string): string {
  const [whole, part] = m.split(".");
  return `${whole} point ${part.split("").join(" ")}`;
}

/** English text said the way a person would read it (kokoro-js's normalize_text). */
export function normalizeEnglish(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/g, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, splitNumber)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, sayMoney)
    .replace(/\d*\.\d+/g, sayDecimal)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_RUN = new RegExp(`(\\s*[${PUNCTUATION.replace(/[\]\\^-]/g, "\\$&")}]+\\s*)+`, "g");

/** Text cut into runs of words and runs of punctuation, so punctuation (and the pause it means) survives eSpeak. */
export function splitPunctuation(text: string): { text: string; punctuation: boolean }[] {
  const parts: { text: string; punctuation: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(PUNCTUATION_RUN)) {
    if (at < m.index) parts.push({ text: text.slice(at, m.index), punctuation: false });
    if (m[0]) parts.push({ text: m[0], punctuation: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), punctuation: false });
  return parts;
}

/** kokoro-js's fixes to eSpeak's English output. */
export function fixEnglish(ps: string, british: boolean): string {
  const fixed = ps
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  return (british ? fixed : fixed.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di")).trim();
}

/** eSpeak's tied symbols to Kokoro's single-character ones (misaki's EspeakG2P). */
const ESPEAK_TO_KOKORO: [string, string][] = [
  ["a^ɪ", "I"], ["a^ʊ", "W"], ["d^z", "ʣ"], ["d^ʒ", "ʤ"], ["e^ɪ", "A"], ["o^ʊ", "O"],
  ["ə^ʊ", "Q"], ["s^s", "S"], ["t^s", "ʦ"], ["t^ʃ", "ʧ"], ["ɔ^ɪ", "Y"],
];

export function fromEspeak(ps: string): string {
  let out = ps;
  for (const [tied, single] of ESPEAK_TO_KOKORO) out = out.replaceAll(tied, single);
  // Language-switch flags like "(en)" around foreign words, leftover ties, and hyphens.
  return out.replace(/\([a-z-]+\)/g, "").replaceAll("^", "").replaceAll("-", "").trim();
}

/** Phonemes to token ids; symbols the model doesn't know are dropped. */
export function tokenize(ps: string): number[] {
  const ids: number[] = [];
  for (const ch of ps) {
    const id = VOCAB[ch];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** Token ids in pieces the model can take, cut at spaces where possible. */
export function chunkTokens(ids: number[], max = MAX_TOKENS): number[][] {
  const chunks: number[][] = [];
  let rest = ids;
  while (rest.length > max) {
    const space = rest.lastIndexOf(SPACE, max);
    const cut = space > 0 ? space : max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(space > 0 ? cut + 1 : cut);
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

/** Runs the `espeak-ng` program; resolves to IPA with tie marks. */
function espeak(text: string, lang: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("espeak-ng", ["-q", "--ipa", "--tie=^", "-v", lang], { stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")) : reject(new Error(`espeak-ng exited with ${code}`)),
    );
    child.stdin.end(text);
  });
}

/** True if the `espeak-ng` program is installed (needed for Spanish and Portuguese). */
export async function hasEspeak(): Promise<boolean> {
  return espeak("a", "es").then(
    () => true,
    () => false,
  );
}

type Phonemize = (text: string, lang: string) => Promise<string[]>;

/**
 * Loads the English phonemizer. Its Emscripten glue installs process-wide
 * error handlers that would print a megabyte of minified code on any crash;
 * remove whatever it added.
 */
async function loadEnglishPhonemizer(): Promise<Phonemize> {
  const before = new Set<unknown>([...process.listeners("uncaughtException"), ...process.listeners("unhandledRejection")]);
  const tidy = () => {
    for (const l of process.listeners("uncaughtException")) if (!before.has(l)) process.removeListener("uncaughtException", l);
    for (const l of process.listeners("unhandledRejection")) if (!before.has(l)) process.removeListener("unhandledRejection", l);
  };
  const { phonemize } = await import("phonemizer");
  await phonemize("a", "en-us");
  tidy();
  return phonemize;
}

/* ---------- Audio ---------- */

/** Reads numpy's .npz (an uncompressed zip of float32 .npy arrays, possibly Zip64) into flat arrays. */
export function readNpz(buf: Buffer): Map<string, Float32Array> {
  const out = new Map<string, Float32Array>();
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    let size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.toString("utf8", at + 30, at + 30 + nameLen);
    // Zip64: the real size is in the extra field (uncompressed, then compressed).
    if (size === 0xffffffff) size = Number(buf.readBigUInt64LE(at + 30 + nameLen + 12));
    const start = at + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error(`${name} is compressed; expected a plain .npz`);
    const npy = buf.subarray(start, start + size);
    const header = npy.toString("latin1", 10, 10 + npy.readUInt16LE(8));
    if (!header.includes("'<f4'")) throw new Error(`${name} isn't float32`);
    const data = npy.subarray(10 + npy.readUInt16LE(8));
    out.set(name.replace(/\.npy$/, ""), new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
    at = start + size;
  }
  return out;
}

/**
 * Drops most of the silence the model leaves around a clip (about 0.3 s
 * before and 0.5 s after), keeping a short natural pause, so sentences
 * played one after another don't drag.
 */
export function trimSilence(audio: Float32Array, rate = SAMPLE_RATE, keepBefore = 0.04, keepAfter = 0.12): Float32Array {
  const threshold = 0.01;
  let first = audio.findIndex((s) => Math.abs(s) > threshold);
  if (first < 0) return audio.subarray(0, 0);
  let last = audio.length - 1;
  while (last > first && Math.abs(audio[last]) <= threshold) last--;
  first = Math.max(0, first - Math.round(keepBefore * rate));
  last = Math.min(audio.length - 1, last + Math.round(keepAfter * rate));
  return audio.subarray(first, last + 1);
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

/* ---------- The model ---------- */

type Ort = typeof import("onnxruntime-node");

export class Kokoro {
  /** Voices this install can speak: English always, Spanish and Portuguese when espeak-ng is installed. */
  readonly voices: VoiceInfo[];
  #ort: Ort;
  #session: InferenceSession;
  #styles: Map<string, Float32Array>;
  #english: Phonemize;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(ort: Ort, session: InferenceSession, styles: Map<string, Float32Array>, english: Phonemize, voices: VoiceInfo[]) {
    this.#ort = ort;
    this.#session = session;
    this.#styles = styles;
    this.#english = english;
    this.voices = voices;
  }

  /** Loads the model from `dir` and warms it up (about 2–3 s). */
  static async load(dir: string): Promise<Kokoro> {
    const [ort, english, espeakInstalled, styles] = await Promise.all([
      import("onnxruntime-node"),
      loadEnglishPhonemizer(),
      hasEspeak(),
      readFile(path.join(dir, VOICES_FILE)).then(readNpz),
    ]);
    const session = await ort.InferenceSession.create(path.join(dir, MODEL_FILE));
    const voices = KOKORO_VOICES.filter((v) => styles.has(v.id) && (v.lang.startsWith("en") || espeakInstalled));
    const kokoro = new Kokoro(ort, session, styles, english, voices);
    await kokoro.synthesize("Hi.", voices[0].id);
    return kokoro;
  }

  /** The phonemes Kokoro reads for `text` in this voice's language. */
  async phonemes(text: string, voiceId: string): Promise<string> {
    const family = voiceId[0];
    const lang = ESPEAK_LANG[family];
    if (!lang) throw new Error(`No phonemizer for voice ${voiceId}`);
    const english = family === "a" || family === "b";
    const parts = splitPunctuation(english ? normalizeEnglish(text) : text);
    const said = await Promise.all(
      parts.map(async (p) => {
        if (p.punctuation || !p.text.trim()) return p.text;
        return english ? (await this.#english(p.text, lang)).join(" ") : fromEspeak(await espeak(p.text, lang));
      }),
    );
    const ps = said.join("");
    return english ? fixEnglish(ps, family === "b") : ps.trim();
  }

  /** One sentence of speech at 24 kHz. Requests run one at a time, in the order they came. */
  synthesize(text: string, voiceId: string, signal?: AbortSignal): Promise<Float32Array> {
    const run = this.#queue.then(() => {
      signal?.throwIfAborted();
      return this.#synthesize(text, voiceId);
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #synthesize(text: string, voiceId: string): Promise<Float32Array> {
    const voice = this.voices.find((v) => v.id === voiceId) ?? this.voices[0];
    const style = this.#styles.get(voice.id)!;
    const { Tensor } = this.#ort;
    const tokensInput = this.#session.inputNames.find((n) => n !== "style" && n !== "speed") ?? "tokens";
    const pieces: Float32Array[] = [];
    for (const ids of chunkTokens(tokenize(await this.phonemes(text, voice.id)))) {
      // One style vector per length: n tokens use row n - 1.
      const row = (Math.min(ids.length, MAX_TOKENS) - 1) * STYLE_SIZE;
      const out = await this.#session.run({
        [tokensInput]: new Tensor("int64", BigInt64Array.from([0, ...ids, 0], (n) => BigInt(n)), [1, ids.length + 2]),
        style: new Tensor("float32", style.slice(row, row + STYLE_SIZE), [1, STYLE_SIZE]),
        speed: new Tensor("float32", new Float32Array([1]), [1]),
      });
      pieces.push(trimSilence(out[this.#session.outputNames[0]].data as Float32Array));
    }
    const audio = new Float32Array(pieces.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of pieces) {
      audio.set(p, at);
      at += p.length;
    }
    return audio;
  }
}
