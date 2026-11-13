// Hands-free listening with speech recognition on Lei's own server (Parakeet,
// an open-source model) instead of the browser's: the audio never leaves the
// computer. The microphone is streamed with echo cancellation, so she can
// keep listening while she talks. Speaking over her lowers her voice; real
// words ("wait", "no, the other one") stop her. The server decides when an
// utterance is finished (see server/listening.ts).
//
// Same interface as Listener (listener.js), so the app can use either.
// pause() and resume() mean "her turn" and "your turn". With talking over her
// allowed, the mic stays open through her turn; otherwise it goes quiet.

export class Ears {
  /**
   * @param {{
   *   onHeard: (text: string) => void,
   *   onUtterance: (text: string, timing: { waitedMs: number, decodeMs: number }) => void,
   *   onChange: () => void,
   *   onError: (code: string) => void,
   *   onDuck: (on: boolean) => void,
   *   onBarge: () => void,
   * }} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.supported = !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode && window.WebSocket);
    /** Unused: the server's model detects the language itself. Kept for Listener's interface. */
    this.lang = "";
    this.wanted = false;
    /** Her turn: she's speaking or music is playing. */
    this.paused = false;
    /** Keep listening during her turn, so they can talk over her. */
    this.bargeIn = true;
    this.partial = "";
    /** The server hears sound that might be speech. */
    this.speech = false;
    this.ws = null;
    this.ctx = null;
    this.stream = null;
    this.retries = 0;
  }

  /** Listening right now. */
  get active() {
    return this.wanted && (!this.paused || this.bargeIn);
  }

  get hearing() {
    return this.wanted && (this.speech || !!this.partial);
  }

  async start() {
    if (!this.supported || this.wanted) return;
    this.wanted = true;
    this.paused = false;
    this.retries = 0;
    this.hooks.onChange();
    try {
      await this.#openMic();
    } catch (err) {
      this.wanted = false;
      this.#closeMic();
      this.hooks.onChange();
      this.hooks.onError(err?.name === "NotAllowedError" ? "denied" : err?.name === "NotFoundError" ? "no-mic" : "failed");
      return;
    }
    // Turned off while the browser was still asking for the mic.
    if (!this.wanted) return this.#closeMic();
    this.#connect();
  }

  stop() {
    this.wanted = false;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.#closeMic();
    this.#clear();
    this.hooks.onChange();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.#send({ type: "speaking", on: true });
    if (!this.bargeIn) this.#clear();
    this.hooks.onChange();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.#send({ type: "speaking", on: false });
    this.hooks.onChange();
  }

  /** She started saying this sentence; the server uses it to tell her echo from the person. */
  herSentence(text) {
    this.#send({ type: "speaking", on: true, text });
  }

  setBargeIn(on) {
    this.bargeIn = on;
    this.#send({ type: "mode", bargeIn: on });
  }

  /** Forget what was being heard (the person typed instead). */
  reset() {
    this.#send({ type: "reset" });
    this.#clear();
  }

  async #openMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.audioWorklet.addModule("/js/mic-worklet.js");
    const node = new AudioWorkletNode(this.ctx, "mic-frames");
    node.port.onmessage = (e) => {
      if (this.ws?.readyState === WebSocket.OPEN && this.active) this.ws.send(e.data);
    };
    this.ctx.createMediaStreamSource(this.stream).connect(node);
    // The worklet must be connected to run; a silent gain keeps the mic from playing back.
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    node.connect(silent).connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (!this.wanted) return;
      this.stop();
      this.hooks.onError("no-mic");
    });
  }

  #closeMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
  }

  #connect() {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/listen`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.retries = 0;
      ws.send(JSON.stringify({ type: "mode", bargeIn: this.bargeIn }));
      if (this.paused) ws.send(JSON.stringify({ type: "speaking", on: true }));
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      try {
        this.#event(JSON.parse(e.data));
      } catch {}
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.#clear();
      if (!this.wanted) return;
      if (++this.retries > 5) {
        this.stop();
        this.hooks.onError("failed");
      } else setTimeout(() => this.wanted && !this.ws && this.#connect(), 400 * this.retries);
    };
    this.ws = ws;
  }

  #event(e) {
    if (e.type === "speech") {
      this.speech = e.on;
      this.hooks.onChange();
    } else if (e.type === "partial") {
      this.partial = e.text;
      this.hooks.onHeard(e.text);
      this.hooks.onChange();
    } else if (e.type === "final") {
      this.#clear();
      this.hooks.onChange();
      this.hooks.onUtterance(e.text, { waitedMs: e.waitedMs, decodeMs: e.decodeMs });
    } else if (e.type === "duck") {
      if (!e.on) this.#clear();
      this.hooks.onDuck(e.on);
    } else if (e.type === "barge") {
      this.hooks.onBarge();
    }
  }

  #send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  #clear() {
    this.speech = false;
    if (this.partial) {
      this.partial = "";
      this.hooks.onHeard("");
    }
  }
}
