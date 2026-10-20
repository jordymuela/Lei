// Plays the companion's compositions with a small WebAudio "piano":
// triangle + octave sine, soft decay, a low-pass filter and a generated reverb.

import { parseNotes } from "./lib/notes.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Music {
  /** @param {{ onChange: () => void, onNote: () => void }} hooks */
  constructor(hooks) {
    this.hooks = hooks;
    this.ctx = null;
    this.out = null;
    this.wet = null;
    /** @type {{ bus: GainNode, song: import("./lib/notes.js").Song } | null} */
    this.current = null;
    this.timers = [];
  }

  /** Creates or resumes the audio context. Call from a click so the browser allows sound. */
  ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) {
      const c = (this.ctx = new AC());
      const comp = c.createDynamicsCompressor();
      comp.connect(c.destination);
      this.out = c.createGain();
      this.out.gain.value = 0.9;
      this.out.connect(comp);
      const rev = c.createConvolver();
      rev.buffer = impulse(c, 2.6);
      rev.connect(this.out);
      this.wet = c.createGain();
      this.wet.gain.value = 0.34;
      this.wet.connect(rev);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** @param {import("./lib/notes.js").Song} song */
  play(song) {
    const c = this.ensure();
    if (!c) return;
    this.stop(true);
    const bus = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3000;
    lp.Q.value = 0.3;
    bus.connect(lp);
    lp.connect(this.out);
    lp.connect(this.wet);
    const beat = 60 / song.tempo;
    const t0 = c.currentTime + 0.1;
    const run = (events, vel, pulse) => {
      let t = t0;
      for (const ev of events) {
        for (const n of ev.pitches) note(c, bus, n, t, ev.beats * beat, vel / Math.sqrt(ev.pitches.length));
        if (pulse && ev.pitches.length) this.timers.push(setTimeout(() => this.hooks.onNote(), (t - c.currentTime) * 1000));
        t += ev.beats * beat;
      }
      return t;
    };
    const end = Math.max(run(parseNotes(song.melody), 0.32, true), run(parseNotes(song.harmony), 0.17, false));
    this.current = { bus, song };
    this.timers.push(
      setTimeout(() => {
        if (this.current?.bus === bus) {
          this.current = null;
          this.hooks.onChange();
        }
      }, (end - c.currentTime + 1.4) * 1000),
    );
    this.hooks.onChange();
  }

  stop(silent = false) {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    if (this.current && this.ctx) {
      const b = this.current.bus;
      b.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      setTimeout(() => b.disconnect(), 500);
    }
    this.current = null;
    if (!silent) this.hooks.onChange();
  }
}

function impulse(c, secs) {
  const len = Math.floor(c.sampleRate * secs);
  const b = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return b;
}

function note(c, dest, n, t, dur, vel) {
  const f = 440 * Math.pow(2, (n - 69) / 12);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.setTargetAtTime(0, t + 0.012, clamp(dur * 1.8, 0.6, 4) / 4);
  g.gain.setTargetAtTime(0, t + dur, 0.28);
  const o1 = c.createOscillator();
  o1.type = "triangle";
  o1.frequency.value = f;
  const o2 = c.createOscillator();
  o2.type = "sine";
  o2.frequency.value = f * 2;
  const g2 = c.createGain();
  g2.gain.value = 0.22;
  o1.connect(g);
  o2.connect(g2);
  g2.connect(g);
  g.connect(dest);
  const end = t + dur + 1.6;
  o1.start(t);
  o2.start(t);
  o1.stop(end);
  o2.stop(end);
}
