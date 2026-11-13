// One page's microphone, heard on the server. Audio arrives as 16 kHz
// samples over a WebSocket; this decides when the person has started and
// finished speaking, what they said, and whether they're talking over her.
//
// Time is counted in audio samples, not wall-clock time, so the logic
// behaves the same however the audio arrives (and in tests).
//
// While she is speaking, the mic keeps listening (the page asks the browser
// for echo cancellation). If speech starts, her voice is ducked. It is
// stopped ("barge") once the words mean they want the floor. Listening noises
// ("mm-hm", "yeah") and her own voice leaking back are let go.

import { HEARING_RATE as RATE, type Vad } from "./hearing.ts";
import { PauseStats, endOfTurnWait, isBackchannel, isEcho, wantsTheFloor, words } from "../public/js/lib/turns.js";

/** Messages to the page. */
export type HearingEvent =
  | { type: "speech"; on: boolean }
  | { type: "partial"; text: string }
  | { type: "final"; text: string; waitedMs: number; decodeMs: number }
  | { type: "duck"; on: boolean }
  | { type: "barge" };

/** Messages from the page (besides binary audio). */
export type HearingControl =
  /** She started a sentence (with its text) or stopped speaking. */
  | { type: "speaking"; on: boolean; text?: string }
  /** Whether talking over her is allowed (else her speech isn't listened to). */
  | { type: "mode"; bargeIn: boolean }
  /** Forget whatever was being heard (the person typed instead, or stopped the mic). */
  | { type: "reset" };

/** Audio kept from before speech was detected, so first syllables aren't clipped. */
const PREROLL = Math.round(0.35 * RATE);
/** The VAD reports silence this long after it begins. */
const VAD_LAG = Math.round(0.1 * RATE);
const PARTIAL_EVERY = Math.round(0.6 * RATE);
/** Faster while she's talking, so "wait" stops her sooner. */
const PARTIAL_OVER_HER = Math.round(0.35 * RATE);
const MAX_UTTERANCE = 30 * RATE;
const KEEP = 32 * RATE;
/** Speech that starts this soon after she stops may still be her echo. */
const ECHO_TAIL = Math.round(0.5 * RATE);

export class ListenSession {
  #vad: Vad;
  #transcribe: (samples: Float32Array) => Promise<string>;
  #send: (e: HearingEvent) => void;
  #pauses: PauseStats;

  #chunks: { at: number; samples: Float32Array }[] = [];
  #now = 0;

  /** Sample where the current utterance starts, or null when nobody is speaking. */
  #start: number | null = null;
  /** Sample where the current pause began, or null while they're talking. */
  #pauseAt: number | null = null;
  #lastDecode = 0;
  #text = "";
  /** Audio up to this sample is covered by #text. */
  #textEnd = 0;
  #decodeMs = 0;
  #decoding = false;
  #again = false;
  /** Bumped whenever an utterance ends, so late transcripts of it are ignored. */
  #gen = 0;
  #ducked = false;
  #barged = false;
  /** The utterance began while she was speaking (so it could be her echo). */
  #overlapped = false;
  /** After her echo was heard, wait for a gap before listening again. */
  #skipUntilSilence = false;
  /** How often her own voice has leaked back; past 2, stop ducking at every sound. */
  #echoes = 0;

  #bargeIn = true;
  #herSpeaking = false;
  #herStoppedAt = -Infinity;
  #herSentences: { at: number; text: string }[] = [];

  constructor(opts: { vad: Vad; transcribe: (samples: Float32Array) => Promise<string>; send: (e: HearingEvent) => void; pauses: PauseStats }) {
    this.#vad = opts.vad;
    this.#transcribe = opts.transcribe;
    this.#send = opts.send;
    this.#pauses = opts.pauses;
  }

  audio(samples: Float32Array): void {
    this.#chunks.push({ at: this.#now, samples });
    this.#now += samples.length;
    while (this.#chunks.length && this.#chunks[0].at + this.#chunks[0].samples.length < this.#now - KEEP) this.#chunks.shift();
    // Not listening to her turn: the page should stop sending, but don't act on it either way.
    if (this.#herSpeaking && !this.#bargeIn) return;
    this.#vad.accept(samples);
    const speaking = this.#vad.speaking();
    if (!speaking) this.#skipUntilSilence = false;
    if (speaking && !this.#skipUntilSilence) this.#onSpeech();
    else if (!speaking && this.#start !== null) this.#onSilence();
  }

  control(msg: HearingControl): void {
    if (msg.type === "speaking") {
      if (msg.on && msg.text) {
        this.#herSentences.push({ at: this.#now, text: msg.text });
        if (this.#herSentences.length > 4) this.#herSentences.shift();
      }
      if (this.#herSpeaking && !msg.on) this.#herStoppedAt = this.#now;
      this.#herSpeaking = msg.on;
      if (!msg.on) this.#ducked = false;
    } else if (msg.type === "mode") {
      this.#bargeIn = msg.bargeIn;
    } else if (msg.type === "reset") {
      this.#vad.reset();
      this.#reset();
    }
  }

  /** What she said recently, if the current utterance could be its echo. */
  #herRecentWords(): string {
    return this.#overlapped ? this.#herSentences.map((s) => s.text).join(" ") : "";
  }

  #onSpeech(): void {
    if (this.#start === null) {
      this.#start = Math.max(this.#chunks[0]?.at ?? 0, this.#now - PREROLL);
      this.#lastDecode = this.#now;
      this.#overlapped = this.#herSpeaking || this.#now - this.#herStoppedAt < ECHO_TAIL;
      this.#send({ type: "speech", on: true });
      if (this.#herSpeaking && this.#echoes < 2) {
        this.#ducked = true;
        this.#send({ type: "duck", on: true });
      }
    } else if (this.#pauseAt !== null) {
      this.#pauses.add(((this.#now - this.#pauseAt) / RATE) * 1000);
      this.#pauseAt = null;
      this.#send({ type: "speech", on: true });
    }
    if (this.#now - this.#start >= MAX_UTTERANCE) {
      this.#pauseAt = this.#now;
      this.#decode();
    } else if (this.#now - this.#lastDecode >= (this.#herSpeaking ? PARTIAL_OVER_HER : PARTIAL_EVERY)) this.#decode();
  }

  #onSilence(): void {
    if (this.#pauseAt === null) {
      this.#pauseAt = Math.max(this.#start!, this.#now - VAD_LAG);
      this.#send({ type: "speech", on: false });
      this.#decode();
    }
    this.#maybeFinish();
  }

  #slice(from: number, to: number): Float32Array {
    const out = new Float32Array(Math.max(0, to - from));
    for (const c of this.#chunks) {
      const a = Math.max(from, c.at);
      const b = Math.min(to, c.at + c.samples.length);
      if (a < b) out.set(c.samples.subarray(a - c.at, b - c.at), a - from);
    }
    return out;
  }

  #decode(): void {
    if (this.#start === null) return;
    if (this.#decoding) {
      this.#again = true;
      return;
    }
    this.#decoding = true;
    this.#again = false;
    const gen = this.#gen;
    const end = this.#now;
    this.#lastDecode = end;
    const began = performance.now();
    this.#transcribe(this.#slice(this.#start, end))
      .catch((err) => {
        console.error(`[hearing] ${err instanceof Error ? err.message : err}`);
        return "";
      })
      .then((text) => {
        this.#decoding = false;
        if (gen !== this.#gen) return;
        this.#text = text;
        this.#textEnd = end;
        this.#decodeMs = performance.now() - began;
        if (text) this.#send({ type: "partial", text });
        if (this.#judgeOverlap()) return;
        if (this.#again || (this.#pauseAt !== null && end < this.#pauseAt)) this.#decode();
        else this.#maybeFinish();
      });
  }

  /** While she's speaking: drop her own echo, stop her if they want the floor. True if the utterance was dropped. */
  #judgeOverlap(): boolean {
    const recent = this.#herRecentWords();
    if (recent && isEcho(this.#text, recent)) {
      if (this.#herSpeaking) this.#echoes++;
      this.#skipUntilSilence = true;
      this.#drop();
      return true;
    }
    // Her words leaking into the mic don't count toward the two that stop her.
    const hers = new Set(words(recent));
    const theirs = words(this.#text).filter((w) => !hers.has(w)).join(" ");
    if (this.#herSpeaking && !this.#barged && wantsTheFloor(theirs)) {
      this.#barged = true;
      this.#send({ type: "barge" });
    }
    return false;
  }

  #maybeFinish(): void {
    if (this.#pauseAt === null || this.#decoding || this.#textEnd < this.#pauseAt) return;
    const silentMs = ((this.#now - this.#pauseAt) / RATE) * 1000;
    if (silentMs < endOfTurnWait(this.#text, this.#pauses.typical())) return;
    const text = this.#text.trim();
    const overHer = this.#herSpeaking && !this.#barged;
    if (!text || (overHer && isBackchannel(text))) return this.#drop();
    // A whole sentence said over her, even if it never sounded like "stop": it's their turn now.
    if (overHer) this.#send({ type: "barge" });
    this.#send({ type: "final", text, waitedMs: Math.round(silentMs), decodeMs: Math.round(this.#decodeMs) });
    this.#reset();
  }

  #drop(): void {
    if (this.#ducked) this.#send({ type: "duck", on: false });
    if (this.#text) this.#send({ type: "partial", text: "" });
    this.#reset();
  }

  #reset(): void {
    this.#gen++;
    this.#start = null;
    this.#pauseAt = null;
    this.#text = "";
    this.#textEnd = 0;
    this.#again = false;
    this.#ducked = false;
    this.#barged = false;
    this.#overlapped = false;
  }
}
