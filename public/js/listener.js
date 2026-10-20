// Hands-free listening with the browser's speech recognition (Chrome, Edge,
// Safari). It turns continuous recognition into whole utterances: once the
// person pauses, the words heard so far are sent as one message.
//
// The app pauses listening while the companion speaks or plays music, so the
// microphone doesn't transcribe her own voice (half-duplex). Interrupting is
// done by tapping the figure or pressing Esc, not by talking over her.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Silence that ends an utterance once the recognizer has finalized the words. */
const PAUSE_MS = 900;
/** Longer wait when the last words are still provisional. */
const PAUSE_INTERIM_MS = 2200;

export class Listener {
  /**
   * @param {{
   *   onHeard: (text: string) => void,
   *   onUtterance: (text: string) => void,
   *   onChange: () => void,
   *   onError: (code: string) => void,
   * }} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.supported = !!SR;
    this.wanted = false;
    this.paused = false;
    this.rec = null;
    this.buffer = "";
    this.interim = "";
    this.timer = 0;
    this.failures = 0;
  }

  /** Listening right now (on, and not paused while the companion talks). */
  get active() {
    return this.wanted && !this.paused;
  }

  get hearing() {
    return !!(this.buffer || this.interim);
  }

  start() {
    if (!this.supported) return;
    this.wanted = true;
    this.paused = false;
    this.failures = 0;
    this.#boot();
    this.hooks.onChange();
  }

  stop() {
    this.wanted = false;
    this.#halt();
    this.hooks.onChange();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.#halt();
    this.hooks.onChange();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.wanted) this.#boot();
    this.hooks.onChange();
  }

  #boot() {
    if (this.rec || !SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    r.onresult = (e) => this.rec === r && this.#result(e);
    r.onerror = (e) => this.rec === r && this.#error(e.error);
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      // Recognition ends on its own after silence or a network hiccup; keep it going.
      if (this.wanted && !this.paused) setTimeout(() => this.wanted && !this.paused && this.#boot(), this.failures ? 1500 : 200);
      this.hooks.onChange();
    };
    this.rec = r;
    try {
      r.start();
    } catch {
      this.rec = null;
    }
  }

  #halt() {
    clearTimeout(this.timer);
    const r = this.rec;
    this.rec = null;
    try {
      r?.abort();
    } catch {}
    this.buffer = "";
    this.interim = "";
    this.hooks.onHeard("");
  }

  #result(e) {
    this.failures = 0;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const words = res[0].transcript.trim();
      if (res.isFinal) this.buffer = this.buffer ? this.buffer + " " + words : words;
      else interim += res[0].transcript;
    }
    this.interim = interim.trim();
    const heard = [this.buffer, this.interim].filter(Boolean).join(" ");
    this.hooks.onHeard(heard);
    clearTimeout(this.timer);
    if (heard) this.timer = setTimeout(() => this.#flush(), this.interim ? PAUSE_INTERIM_MS : PAUSE_MS);
    this.hooks.onChange();
  }

  #flush() {
    const text = [this.buffer, this.interim].filter(Boolean).join(" ").trim();
    const hadInterim = !!this.interim;
    this.buffer = "";
    this.interim = "";
    this.hooks.onHeard("");
    // Provisional words may still be finalized later; restart so they aren't sent twice.
    if (hadInterim) {
      this.#halt();
      if (this.active) this.#boot();
    }
    this.hooks.onChange();
    if (text) this.hooks.onUtterance(text);
  }

  #error(code) {
    if (code === "no-speech" || code === "aborted") return;
    if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
      this.wanted = false;
      this.#halt();
      this.hooks.onError(code === "audio-capture" ? "no-mic" : "denied");
    } else if (++this.failures >= 3) {
      this.wanted = false;
      this.#halt();
      this.hooks.onError(code === "network" ? "network" : "failed");
    }
    this.hooks.onChange();
  }
}
