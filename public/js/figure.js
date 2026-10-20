// The breathing figure-eight: a 3D lissajous line drawn on a canvas. It reads
// the app's phase each frame (idle, listening, thinking, speaking, music) and
// takes "kicks" from spoken words and played notes.

const TAU = Math.PI * 2;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Figure {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {() => { phase: string, hearing: boolean }} read current app state, polled every frame
   */
  constructor(canvas, read) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.read = read;
    this.E = 0;
    this.K = 0;
    this.ang = 0;
    this.last = 0;
    this.color = "#FFF5EF";
    this.colorAt = -1e9;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.c.width = Math.max(1, Math.round(r.width * this.dpr));
    this.c.height = Math.max(1, Math.round(r.height * this.dpr));
  }

  /** A brief burst of energy (a spoken word, a note). */
  kick(v) {
    this.K = Math.min(1.2, this.K + v);
  }

  frame(ts) {
    requestAnimationFrame((t) => this.frame(t));
    const now = ts / 1000;
    const dt = Math.min(0.05, this.last ? now - this.last : 0.016);
    this.last = now;
    if (ts - this.colorAt > 800) {
      this.colorAt = ts;
      this.color = getComputedStyle(document.documentElement).getPropertyValue("--figure").trim() || "#FFF5EF";
    }
    const { phase, hearing } = this.read();
    let target = 0.05, spin = 0.2;
    if (phase === "listening") { target = 0.09; spin = 0.26; }
    if (hearing) { target = 0.16; spin = 0.38; }
    if (phase === "thinking") { target = 0.17; spin = 1.25; }
    if (phase === "speaking") { target = 0.26 + 0.16 * (0.5 + 0.5 * Math.sin(now * 8.3) * Math.sin(now * 2.9)); spin = 0.42; }
    if (phase === "music") { target = 0.2; spin = 0.36; }
    const m = reduceMotion ? 0.3 : 1;
    this.E += (target - this.E) * Math.min(1, dt * 4);
    this.K *= Math.pow(0.05, dt);
    this.ang += spin * dt * m;
    this.draw(now * m, phase);
  }

  draw(t, phase) {
    const { ctx, w, h, dpr } = this;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const E = Math.min(1, this.E + this.K * 0.5);
    let R = Math.min(w * 0.28, h * 0.4);
    R *= 1 + 0.03 * Math.sin(t * 1.15);
    if (phase === "thinking") R *= 1 - 0.07 * (0.5 + 0.5 * Math.sin(t * 3.4));
    const cx = w / 2, cy = h / 2;
    const tl = 0.38 + 0.1 * Math.sin(t * 0.37), ct = Math.cos(tl), st = Math.sin(tl);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = this.color;
    ctx.shadowColor = this.color;
    const N = 240;
    for (const [alpha, lw, off] of [[1, 1.6, 0], [0.5, 1.1, 0.9], [0.26, 0.8, 1.8]]) {
      const a = this.ang + off * 0.42, ca = Math.cos(a), sa = Math.sin(a);
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = (i / N) * TAU;
        const wob = 1 + E * 0.2 * Math.sin(u * 5 + t * 3.1 + off * 2.1) + 0.04 * Math.sin(u * 2 + t * 0.8 + off);
        const x = Math.sin(u) * wob, y = Math.sin(2 * u) * 0.42 * wob, z = Math.cos(u) * 0.55 * wob;
        const x2 = x * ca + z * sa, z2 = -x * sa + z * ca;
        const y3 = y * ct - z2 * st, z3 = y * st + z2 * ct;
        const p = 1.8 / (1.8 + z3);
        const px = cx + x2 * R * p, py = cy + y3 * R * p;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.shadowBlur = 6 + E * 18;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}
