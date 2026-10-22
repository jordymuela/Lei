// The companion's voice. Replies are spoken sentence by sentence while they
// stream in, either with the browser's own speech synthesis or with audio
// from the server's voice (POST /api/tts: Kokoro, ElevenLabs or a local
// speech server). If a server clip fails, that sentence falls back to the browser voice.

import { SentenceFeed, speakable } from "./lib/sentences.js";

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
  /** @param {{ onChange: () => void, onWord: (strength: number) => void }} hooks */
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
  }

  /** Hand over the reply so far; finished sentences start speaking now. */
  push(text, final = false) {
    const chunk = this.feed.next(text, final);
    if (chunk && this.enabled) this.say(chunk);
  }

  /** @param {string} chunk @param {string} [voice] overrides the chosen voice (previews) */
  say(chunk, voice) {
    const text = speakable(chunk);
    if (!text) return;
    const server = voice ? voice.startsWith(SERVER_VOICE) && this.serverAvailable : this.usingServer;
    if (server) this.#sayServer(text, voice || this.voice);
    else this.#sayBrowser(text, voice);
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

  #sayBrowser(text, voiceName) {
    if (!this.synth) return;
    const u = this.#utterance(text, voiceName);
    const gen = this.gen;
    u.onstart = () => {
      if (gen !== this.gen) return;
      this.lastActive = performance.now();
      this.hooks.onWord(0.5);
    };
    u.onboundary = () => gen === this.gen && this.hooks.onWord(0.3);
    u.onend = u.onerror = () => gen === this.gen && this.#finished();
    this.pending++;
    this.lastActive = performance.now();
    this.synth.speak(u);
    this.hooks.onChange();
  }

  #sayServer(text, voice) {
    const blob = fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: serverVoiceId(voice) || this.serverChoices()[0]?.id }),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .catch(() => null);
    this.queue.push({ blob, text });
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
    const { blob: next, text } = this.queue.shift();
    next.then((blob) => {
      if (gen !== this.gen) return;
      if (!blob) return this.#fallback(text, gen);
      const url = URL.createObjectURL(blob);
      const end = () => {
        URL.revokeObjectURL(url);
        if (gen === this.gen) this.#finished();
      };
      this.audio.onended = end;
      this.audio.onerror = end;
      this.audio.src = url;
      this.audio.playbackRate = this.rate;
      this.audio
        .play()
        .then(() => {
          this.lastActive = performance.now();
          this.hooks.onWord(0.5);
        })
        .catch(end);
    });
  }

  // The server couldn't voice this sentence: say it with the browser voice rather than skip it.
  #fallback(text, gen) {
    if (!this.synth) return this.#finished();
    const u = this.#utterance(text);
    u.onstart = () => {
      this.lastActive = performance.now();
      this.hooks.onWord(0.5);
    };
    u.onend = u.onerror = () => gen === this.gen && this.#finished();
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
