// Builds the fake microphone for talk.cjs: a person asks a question, waits,
// then talks over Lei's answer. Uses Kokoro, so run `npm run get-voice` first.
// Usage: node scripts/e2e/make-mic.ts <out.wav>

import { writeFileSync } from "node:fs";
import { config } from "../../server/config.ts";
import { Kokoro, encodeWav } from "../../server/kokoro.ts";

const k = await Kokoro.load(config.voice.dir);
const say = (t: string) => k.synthesize(t, "am_michael");
const silence = (s: number) => new Float32Array(Math.round(s * 24000));
const parts = [silence(1.5), await say("What's the weather like in Lisbon today?"), silence(9), await say("Wait, actually, stop. What about Porto?"), silence(6)];
const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
let at = 0;
for (const p of parts) {
  all.set(p, at);
  at += p.length;
}
writeFileSync(process.argv[2] ?? "fake-mic.wav", encodeWav(all, 24000));
process.exit(0);
