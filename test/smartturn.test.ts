import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { Fft, whisperFeatures } from "../server/smartturn.ts";
import { readZipEntry } from "../server/unzip.ts";

test("the mixed-radix FFT matches a direct DFT, at 400 points and others", () => {
  for (const n of [400, 25, 12, 8, 1]) {
    const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 1.3) + ((i * 7) % 5) / 10);
    const im = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.7));
    const oRe = new Float64Array(n);
    const oIm = new Float64Array(n);
    new Fft(n).transform(re, im, oRe, oIm);
    let err = 0;
    for (let k = 0; k < n; k++) {
      let a = 0;
      let b = 0;
      for (let t = 0; t < n; t++) {
        const w = (-2 * Math.PI * k * t) / n;
        a += re[t] * Math.cos(w) - im[t] * Math.sin(w);
        b += re[t] * Math.sin(w) + im[t] * Math.cos(w);
      }
      err = Math.max(err, Math.abs(a - oRe[k]), Math.abs(b - oIm[k]));
    }
    assert.ok(err < 1e-9, `n=${n} error ${err}`);
  }
});

test("Whisper features are 80 mel bands × 800 frames, at most 2 apart after scaling", () => {
  // Half a second of a 440 Hz tone at the very end of 8 s of silence.
  const audio = Float32Array.from({ length: 8000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 16000));
  const f = whisperFeatures(audio);
  assert.equal(f.length, 80 * 800);
  const max = Math.max(...f);
  assert.ok(max > 1 && max < 2.5, `max ${max}`);
  assert.ok(Math.min(...f) >= max - 2 - 1e-6);
  // The tone sits in the last 50 frames, in a low mel band (band 11 holds 440 Hz).
  const band = (m: number, from: number, to: number) => f.slice(m * 800 + from, m * 800 + to).reduce((s, v) => s + v, 0) / (to - from);
  assert.ok(band(11, 760, 800) > band(11, 0, 700) + 1);
});

/** A zip with one stored and one deflated entry, like Python writes. */
function zip(files: Record<string, { data: Buffer; deflate: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, f] of Object.entries(files)) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, body);
    central.push(ch, n);
    offset += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test("one file is read out of a zip, stored or deflated", () => {
  const model = Buffer.from("model bytes ".repeat(100));
  const z = zip({ "a/readme.txt": { data: Buffer.from("hi"), deflate: false }, "a/data/model.onnx": { data: model, deflate: true } });
  assert.deepEqual(readZipEntry(z, "a/data/model.onnx"), model);
  assert.equal(readZipEntry(z, "a/readme.txt").toString(), "hi");
  assert.throws(() => readZipEntry(z, "missing.onnx"), /isn't in the archive/);
  assert.throws(() => readZipEntry(Buffer.from("not a zip at all, nope"), "x"), /Not a zip/);
});
