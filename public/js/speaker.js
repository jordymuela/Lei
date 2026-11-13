// The companion's voice. Replies are spoken sentence by sentence while they
// stream in, either with the browser's own speech synthesis or with audio
// from the server's voice (POST /api/tts: Kokoro, ElevenLabs or a local
// speech server). If a server clip fails, that sentence falls back to the browser voice.
//
// It also keeps track of how far into the reply she got, so an interrupted
// reply is remembered only up to what was heard. Her voice can be ducked
// while the person starts talking over her. A short "hmm" can fill a long
// silence before a reply.

import { SentenceFeed, speakable } from "./lib/sentences.js";

/** What she says when a reply is slow to start. */
// Short, so a reply that arrives right after isn't held up. ("Mm" would be spelled out as letters.)
const FILLERS = ["Hmm.", "Let me see."];
const DUCKED = 0.25;

/** Voice ids for the server's voices: "server" (its default) or "server:<id>". */
export const SERVER_VOICE = "server";
const serverVoiceId = (voice) => (voice.startsWith(SERVER_VOICE + ":") ? voice.slice(SERVER_VOICE.length + 1) : "");

const PREFERRED = ["samantha", "ava", "allison", "susan", "zoe", "serena", "karen", "moira", "tessa", "kate", "aria", "jenny", "sonia", "libby", "emma", "natasha", "google uk english female", "google us english", "zira", "paulina", "monica", "luciana", "amélie", "anna"];
const NOVELTY = /novelty|whisper|bells|bad news|good news|boing|bubbles|cellos|zarvox|trinoids|organ|hysterical|jester|superstar|albert|fred|junior|ralph|bahh|wobble|grandpa|grandma|rocko|shelley|flo|eddy|reed|sandy/;

export const prettyVoice = (name) =>
  name.replace(/^(Microsoft|Google|Apple)\s+/, "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+-\s+.*$/, "").replace(/\s+Online.*$/, "").trim();

export function previewLine(lang) {
  const l = (lang || "en").slice(0, 2).toLowerCase();
  return { es: "Hola. Así es como sonaría.", fr: "Bonjour. Voilà comment je sonnerais.", pt: "Olá. É assim que eu soaria.", de: "Hallo. So würde ich klingen.", it: "Ciao. Ecco come suonerei." }[l] || "Hi. This is how I would sound.";
}

export class Speaker {
  /** @param {{ onChange: () => void, onWord: (strength: number) => void, onSentence?: (text: string) => void }} hooks */
  constructor(hooks) {
    this.hooks = hooks;
    this.synth = "speechSynthesis" in window ? window.speechSynthesis : null;
    this.serverAvailable = false;
    /** The server's voices: { id, label, lang } ("" lang = any language). */
    this.serverVoices = [];
    /** Language the voice speaks; empty = the browser's language. */
    this.lang = "";
    this.enabled = true;
    /** A browser voice name, a server voice ("server" or "server:<id>"), or "" for the best available. */
    this.voice = "";
    this.rate = 1;
    this.voices = [];
    this.pending = 0;
    this.gen = 0;
    this.waiters = [];
    this.feed = new SentenceFeed();
    this.audio = new Audio();
    this.queue = [];
    this.playing = false;
    this.unlocked = false;
    this.lastActive = 0;
    /** The current reply's spoken parts: { from, to, startedAt, duration, done, fraction } (offsets into the reply text). */
    this.parts = [];
    this.ducked = false;
    this.duckTimer = 0;
    /** Cached filler clips by server voice id. */
    this.fillers = new Map();
    this.onVoices = () => {};
    if (this.synth) {
      const load = () => {
        this.voices = this.synth.getVoices() || [];
        this.onVoices();
      };
      load();
      this.synth.addEventListener?.("voiceschanged", load);
    }
    setInterval(() => this.watchdog(), 1000);
  }

  get available() {
    return this.serverAvailable || !!this.synth;
  }

  get speaking() {
    return this.pending > 0;
  }

  /** True when replies use the server's voice: one was picked, or none was and it has one for this language. */
  get usingServer() {
    if (!this.serverAvailable) return false;
    if (this.voice.startsWith(SERVER_VOICE + ":")) return true;
    return (this.voice === SERVER_VOICE || !this.voice) && (this.serverChoices().length > 0 || !this.synth);
  }

  /** The server's voices that speak the speaking language. */
  serverChoices() {
    const lang = (this.lang || navigator.language || "en").slice(0, 2).toLowerCase();
    return this.serverVoices.filter((v) => !v.lang || v.lang.slice(0, 2).toLowerCase() === lang);
  }

  /** Browser voices for the speaking language, best-sounding first. */
  ranked() {
    const lang = (this.lang || navigator.language || "en").slice(0, 2).toLowerCase();
    let pool = this.voices.filter((v) => (v.lang || "").toLowerCase().startsWith(lang));
    if (!pool.length) pool = this.voices.filter((v) => /^en/i.test(v.lang || ""));
    if (!pool.length) pool = this.voices.slice();
    const score = (v) => {
      const n = v.name.toLowerCase();
      let s = 100;
      PREFERRED.forEach((p, i) => {
        if (n.includes(p)) s = Math.min(s, i);
      });
      if (/premium|enhanced|natural|neural/.test(n)) s -= 30;
      if (NOVELTY.test(n)) s += 500;
      return s;
    };
    const seen = new Set();
    return pool.filter((v) => !seen.has(v.name) && seen.add(v.name)).sort((a, b) => score(a) - score(b));
  }

  browserVoice() {
    return this.voices.find((v) => v.name === this.voice) || this.ranked()[0] || null;
  }

  /** Call from a click: browsers only allow speech and audio after the person interacts. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      if (this.synth) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        this.synth.speak(u);
      }
      this.audio.src = silentWav();
      this.audio.play().catch(() => {});
    } catch {}
  }

  /** Start of a new reply. */
  begin() {
    this.feed.reset();
    this.parts = [];
  }

  /** Hand over the reply so far; finished sentences start speaking now. */
  push(text, final = false) {
    const from = this.feed.spoken;
    const chunk = this.feed.next(text, final);
    if (chunk && this.enabled) this.say(chunk, undefined, { from, to: this.feed.spoken });
  }

  /**
   * @param {string} chunk
   * @param {string} [voice] overrides the chosen voice (previews)
   * @param {{ from: number, to: number }} [range] where the chunk sits in the reply, for heardChars()
   */
  say(chunk, voice, range) {
    const text = speakable(chunk);
    if (!text) return;
    const part = range ? { ...range, startedAt: 0, duration: 0, done: false, fraction: null } : null;
    if (part) this.parts.push(part);
    const server = voice ? voice.startsWith(SERVER_VOICE) && this.serverAvailable : this.usingServer;
    if (server) this.#sayServer(text, voice || this.voice, part);
    else this.#sayBrowser(text, voice, part);
  }

  /**
   * How many characters of the current reply she has actually said: whole
   * sentences played, plus the share of the one playing now.
   */
  heardChars() {
    let chars = 0;
    for (const p of this.parts) {
      if (p.done) chars = p.to;
      else {
        if (p.startedAt) {
          const share = p.fraction ?? (p.duration ? Math.min(1, (performance.now() - p.startedAt) / 1000 / p.duration) : 0);
          chars = p.from + Math.floor((p.to - p.from) * share);
        }
        break;
      }
    }
    return chars;
  }

  /** Lower her voice while the person may be starting to talk (server voice only; browser voices can't change volume mid-sentence). */
  duck(on) {
    if (this.ducked === on) return;
    this.ducked = on;
    clearInterval(this.duckTimer);
    const target = on ? DUCKED : 1;
    this.duckTimer = setInterval(() => {
      const v = this.audio.volume;
      const next = Math.abs(target - v) < 0.06 ? target : v + (target - v) * 0.35;
      this.audio.volume = next;
      if (next === target) clearInterval(this.duckTimer);
    }, 16);
  }

  /** Fetches the filler clips for the current server voice, so filler() can play at once. */
  prepareFillers() {
    if (!this.usingServer) return;
    const id = serverVoiceId(this.voice) || this.serverChoices()[0]?.id;
    const key = `${id}@${this.rate}`;
    if (!id || this.fillers.has(key)) return;
    this.fillers.set(key, []);
    for (const text of FILLERS) {
      this.#fetchClip(text, id).then((blob) => blob && this.fillers.get(key)?.push(blob));
    }
  }

  /** Says a short "hmm" if nothing is being said and a clip is ready. True if it did. */
  filler() {
    if (!this.enabled || !this.usingServer || this.pending) return false;
    const id = serverVoiceId(this.voice) || this.serverChoices()[0]?.id;
    const clips = this.fillers.get(`${id}@${this.rate}`);
    if (!clips?.length) return false;
    const blob = clips[Math.floor(Math.random() * clips.length)];
    this.queue.unshift({ blob: Promise.resolve(blob), text: "", part: null });
    this.pending++;
    this.hooks.onChange();
    this.#pump();
    return true;
  }

  preview(voice) {
    this.stop();
    this.unlock();
    const v = this.voices.find((x) => x.name === voice);
    const sv = this.serverVoices.find((x) => x.id === serverVoiceId(voice || ""));
    this.say(previewLine(v?.lang || sv?.lang || this.lang || navigator.language), voice || this.voice || SERVER_VOICE);
  }

  whenDone(fn) {
    if (!this.pending) fn();
    else this.waiters.push(fn);
  }

  stop() {
    this.gen++;
    this.pending = 0;
    this.waiters = [];
    this.queue = [];
    this.playing = false;
    try {
      this.synth?.cancel();
    } catch {}
    this.audio.pause();
    this.ducked = false;
    clearInterval(this.duckTimer);
    this.audio.volume = 1;
    this.hooks.onChange();
  }

  #utterance(text, voiceName) {
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceName ? this.voices.find((x) => x.name === voiceName) : this.browserVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = this.rate;
    return u;
  }

  #sayBrowser(text, voiceName, part) {
    if (!this.synth) return;
    const u = this.#utterance(text, voiceName);
    const gen = this.gen;
    u.onstart = () => {
      if (gen !== this.gen) return;
      this.lastActive = performance.now();
      if (part) part.startedAt = performance.now();
      this.hooks.onSentence?.(text);
      this.hooks.onWord(0.5);
    };
    u.onboundary = (e) => {
      if (gen !== this.gen) return;
      if (part) part.fraction = Math.min(1, (e.charIndex || 0) / text.length);
      this.hooks.onWord(0.3);
    };
    u.onend = u.onerror = () => {
      if (gen !== this.gen) return;
      if (part) part.done = true;
      this.#finished();
    };
    this.pending++;
    this.lastActive = performance.now();
    this.synth.speak(u);
    this.hooks.onChange();
  }

  #fetchClip(text, voiceId) {
    return fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Speed is applied by the voice itself: speeding up playback would change her pitch and sound worse.
      body: JSON.stringify({ text, voice: voiceId, speed: this.rate }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
  }

  #sayServer(text, voice, part) {
    const blob = this.#fetchClip(text, serverVoiceId(voice) || this.serverChoices()[0]?.id);
    this.queue.push({ blob, text, part });
    this.pending++;
    this.lastActive = performance.now();
    this.hooks.onChange();
    this.#pump();
  }

  // Plays fetched clips in order; each next clip is already downloading while the current one plays.
  #pump() {
    if (this.playing || !this.queue.length) return;
    this.playing = true;
    const gen = this.gen;
    const { blob: next, text, part } = this.queue.shift();
    next.then((blob) => {
      if (gen !== this.gen) return;
      if (!blob) return this.#fallback(text, gen, part);
      const url = URL.createObjectURL(blob);
      const end = () => {
        URL.revokeObjectURL(url);
        if (gen !== this.gen) return;
        if (part) part.done = true;
        this.#finished();
      };
      this.audio.onended = end;
      this.audio.onerror = end;
      this.audio.onloadedmetadata = () => part && (part.duration = this.audio.duration || 0);
      this.audio.src = url;
      this.audio.playbackRate = 1;
      this.audio.volume = this.ducked ? DUCKED : 1;
      this.audio
        .play()
        .then(() => {
          if (gen !== this.gen) return;
          this.lastActive = performance.now();
          if (part) part.startedAt = performance.now();
          if (text) this.hooks.onSentence?.(text);
          this.hooks.onWord(0.5);
        })
        .catch(end);
    });
  }

  // The server couldn't voice this sentence: say it with the browser voice rather than skip it.
  #fallback(text, gen, part) {
    if (!this.synth || !text) {
      if (part) part.done = true;
      return this.#finished();
    }
    const u = this.#utterance(text);
    u.onstart = () => {
      this.lastActive = performance.now();
      if (part) part.startedAt = performance.now();
      this.hooks.onSentence?.(text);
      this.hooks.onWord(0.5);
    };
    u.onend = u.onerror = () => {
      if (gen !== this.gen) return;
      if (part) part.done = true;
      this.#finished();
    };
    this.lastActive = performance.now();
    this.synth.speak(u);
  }

  #finished() {
    this.playing = false;
    this.pending = Math.max(0, this.pending - 1);
    if (!this.pending) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((f) => f());
    }
    this.hooks.onChange();
    this.#pump();
  }

  // Some engines occasionally never fire `end`. If nothing is audibly playing for a while, let go.
  watchdog() {
    if (!this.pending) return;
    const busy = (this.synth && (this.synth.speaking || this.synth.pending)) || (!this.audio.paused && !this.audio.ended) || this.queue.length;
    if (busy) {
      this.lastActive = performance.now();
      return;
    }
    if (performance.now() - this.lastActive > (this.usingServer ? 8000 : 2500)) {
      this.pending = 1;
      this.#finished();
    }
  }
}

let silent = "";
function silentWav() {
  if (silent) return silent;
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  silent = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  return silent;
}
