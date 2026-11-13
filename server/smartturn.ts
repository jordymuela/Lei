// Smart Turn v3.2 (Pipecat, BSD-2-Clause): a small model that listens to
// the last 8 seconds of speech and judges from the voice itself (pitch,
// rhythm, the trailing-off) whether the person has finished their turn.
// Words alone can't tell "I went to the store." from "I went to the store…".
// listening.ts combines its verdict with the transcript (turns.js).
//
// The model takes Whisper-style log-mel features, computed here to match
// Pipecat's _whisper_features.py (itself vendored from Hugging Face
// Transformers): 80 mel bands × 800 frames of 10 ms.

import type { InferenceSession } from "onnxruntime-node";

export const SMART_TURN_FILE = "smart-turn-v3.2-cpu.onnx";

const RATE = 16_000;
const SAMPLES = 8 * RATE;
const N_FFT = 400;
const HOP = 160;
const N_MELS = 80;
const BINS = N_FFT / 2 + 1;
const FRAMES = SAMPLES / HOP;

/* ---------- FFT (mixed radix, for N = 400 = 2^4 · 5^2) ---------- */

/** Splits n into small factors (4s and 2s, then any odd primes). */
function factorize(n: number): number[] {
  const f: number[] = [];
  for (const p of [4, 2, 3, 5]) while (n % p === 0) (f.push(p), (n /= p));
  for (let p = 7; n > 1; p += 2) while (n % p === 0) (f.push(p), (n /= p));
  return f;
}

/** A complex FFT of fixed size; reuse it, the twiddles are precomputed. */
export class Fft {
  readonly n: number;
  #factors: number[];
  #cos: Float64Array;
  #sin: Float64Array;
  #tmpRe: Float64Array;
  #tmpIm: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.#factors = factorize(n);
    this.#cos = new Float64Array(n);
    this.#sin = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.#cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.#sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    const p = Math.max(...this.#factors, 1);
    this.#tmpRe = new Float64Array(p);
    this.#tmpIm = new Float64Array(p);
  }

  /** out = DFT(in); `in` is read with the given stride. */
  transform(inRe: Float64Array, inIm: Float64Array, outRe: Float64Array, outIm: Float64Array): void {
    this.#step(inRe, inIm, 0, 1, outRe, outIm, 0, this.n, 0);
  }

  #step(inRe: Float64Array, inIm: Float64Array, inOff: number, stride: number, outRe: Float64Array, outIm: Float64Array, outOff: number, n: number, fi: number): void {
    if (n === 1) {
      outRe[outOff] = inRe[inOff];
      outIm[outOff] = inIm[inOff];
      return;
    }
    const p = this.#factors[fi];
    const m = n / p;
    // p interleaved sub-transforms of size m, written one after another.
    for (let q = 0; q < p; q++) this.#step(inRe, inIm, inOff + q * stride, stride * p, outRe, outIm, outOff + q * m, m, fi + 1);
    const tw = this.n / n;
    const tRe = this.#tmpRe;
    const tIm = this.#tmpIm;
    for (let k = 0; k < m; k++) {
      // Twiddle each sub-result, then a size-p DFT across them.
      for (let q = 0; q < p; q++) {
        const i = outOff + q * m + k;
        const w = (q * k * tw) % this.n;
        const c = this.#cos[w];
        const s = this.#sin[w];
        tRe[q] = outRe[i] * c - outIm[i] * s;
        tIm[q] = outRe[i] * s + outIm[i] * c;
      }
      for (let j = 0; j < p; j++) {
        let re = 0;
        let im = 0;
        for (let q = 0; q < p; q++) {
          const w = ((q * j) % p) * (this.n / p);
          re += tRe[q] * this.#cos[w] - tIm[q] * this.#sin[w];
          im += tRe[q] * this.#sin[w] + tIm[q] * this.#cos[w];
        }
        outRe[outOff + k + j * m] = re;
        outIm[outOff + k + j * m] = im;
      }
    }
  }
}

/* ---------- Whisper log-mel features ---------- */

const hzToMel = (f: number) => (f >= 1000 ? 15 + (Math.log(f / 1000) * 27) / Math.log(6.4) : (3 * f) / 200);
const melToHz = (m: number) => (m >= 15 ? 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15)) : (200 * m) / 3);

/** Slaney-normalized triangular mel filters, [mel][bin]. */
function melFilters(): Float64Array[] {
  const melMax = hzToMel(RATE / 2);
  const filterHz = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz((melMax * i) / (N_MELS + 1)));
  const fftHz = Array.from({ length: BINS }, (_, i) => ((RATE / 2) * i) / (BINS - 1));
  return Array.from({ length: N_MELS }, (_, m) => {
    const row = new Float64Array(BINS);
    const norm = 2 / (filterHz[m + 2] - filterHz[m]);
    for (let b = 0; b < BINS; b++) {
      const down = (fftHz[b] - filterHz[m]) / (filterHz[m + 1] - filterHz[m]);
      const up = (filterHz[m + 2] - fftHz[b]) / (filterHz[m + 2] - filterHz[m + 1]);
      row[b] = Math.max(0, Math.min(down, up)) * norm;
    }
    return row;
  });
}

let tables: { fft: Fft; hann: Float64Array; mel: Float64Array[] } | null = null;

/** The last 8 s of `audio` (16 kHz), padded with silence in front, as the model's [80 × 800] input. */
export function whisperFeatures(audio: Float32Array): Float32Array {
  tables ??= {
    fft: new Fft(N_FFT),
    hann: Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)),
    mel: melFilters(),
  };
  const { fft, hann, mel } = tables;
  const x = new Float32Array(SAMPLES);
  const tail = audio.subarray(Math.max(0, audio.length - SAMPLES));
  x.set(tail, SAMPLES - tail.length);
  // Zero-mean, unit-variance over the whole window, as WhisperFeatureExtractor does.
  let mean = 0;
  for (const v of x) mean += v;
  mean /= SAMPLES;
  let variance = 0;
  for (const v of x) variance += (v - mean) ** 2;
  const scale = 1 / Math.sqrt(variance / SAMPLES + 1e-7);
  const pad = N_FFT / 2;
  const at = (i: number) => {
    // Reflect padding at both ends (numpy's "reflect": the edge sample isn't repeated).
    const j = i < 0 ? -i : i >= SAMPLES ? 2 * (SAMPLES - 1) - i : i;
    return (x[j] - mean) * scale;
  };
  const re = new Float64Array(N_FFT);
  const im = new Float64Array(N_FFT);
  const outRe = new Float64Array(N_FFT);
  const outIm = new Float64Array(N_FFT);
  const power = new Float64Array(BINS);
  const logMel = new Float64Array(N_MELS * FRAMES);
  let max = -Infinity;
  // 801 frames are computed; the reference drops the last one.
  for (let f = 0; f < FRAMES; f++) {
    const start = f * HOP - pad;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = at(start + i) * hann[i];
      im[i] = 0;
    }
    fft.transform(re, im, outRe, outIm);
    for (let b = 0; b < BINS; b++) power[b] = outRe[b] * outRe[b] + outIm[b] * outIm[b];
    for (let m = 0; m < N_MELS; m++) {
      const row = mel[m];
      let e = 0;
      for (let b = 0; b < BINS; b++) e += row[b] * power[b];
      const v = Math.log10(Math.max(1e-10, e));
      logMel[m * FRAMES + f] = v;
      if (v > max) max = v;
    }
  }
  const out = new Float32Array(N_MELS * FRAMES);
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(logMel[i], max - 8) + 4) / 4;
  return out;
}

/* ---------- The model ---------- */

export interface SmartTurn {
  /** Probability (0–1) that the person has finished, from the end of `audio` (16 kHz). */
  predict(audio: Float32Array): Promise<number>;
}

export async function loadSmartTurn(file: string): Promise<SmartTurn> {
  const ort = await import("onnxruntime-node");
  const session: InferenceSession = await ort.InferenceSession.create(file, {
    executionMode: "sequential",
    interOpNumThreads: 1,
    intraOpNumThreads: 1,
    graphOptimizationLevel: "all",
  });
  const input = session.inputNames[0] ?? "input_features";
  const predict = async (audio: Float32Array) => {
    const out = await session.run({ [input]: new ort.Tensor("float32", whisperFeatures(audio), [1, N_MELS, FRAMES]) });
    return Number((out[session.outputNames[0]].data as Float32Array)[0]);
  };
  await predict(new Float32Array(RATE));
  return { predict };
}
