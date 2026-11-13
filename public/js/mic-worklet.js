// Runs on the audio thread: turns the microphone into 16 kHz mono 16-bit
// frames of 40 ms and posts them to the page, which sends them to the server
// for speech recognition.

const OUT_RATE = 16000;
const FRAME = 640;

class MicFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / OUT_RATE;
    this.pos = 0;
    this.prev = 0;
    this.lp = 0;
    this.frame = new Int16Array(FRAME);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    // A one-pole low-pass keeps most energy above 8 kHz from folding into the speech band.
    const a = Math.min(1, (2 * Math.PI * 7000) / sampleRate);
    for (let i = 0; i < input.length; i++) {
      const x = (this.lp += a * (input[i] - this.lp));
      // Linear interpolation between the previous and current input sample.
      while (this.pos < 1) {
        const y = this.prev + (x - this.prev) * this.pos;
        this.frame[this.n++] = Math.max(-32768, Math.min(32767, Math.round(y * 32767)));
        if (this.n === FRAME) {
          this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
          this.frame = new Int16Array(FRAME);
          this.n = 0;
        }
        this.pos += this.step;
      }
      this.pos -= 1;
      this.prev = x;
    }
    return true;
  }
}

registerProcessor("mic-frames", MicFrames);
