// Downloads Kokoro, the open-source voice (about 350 MB), into data/voices
// (or LEI_VOICE_DIR) and checks every file against its pinned SHA-256, so a
// tampered or truncated download is never loaded. Safe to run again: files
// that are already right are skipped.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../server/config.ts";
import { KOKORO_FILES } from "../server/kokoro.ts";

async function sha256(file: string): Promise<string | null> {
  const hash = createHash("sha256");
  try {
    await pipeline(createReadStream(file), hash);
  } catch {
    return null;
  }
  return hash.digest("hex");
}

const mb = (n: number) => (n / 1e6).toFixed(0) + " MB";

await mkdir(config.voice.dir, { recursive: true });
for (const f of KOKORO_FILES) {
  const dest = path.join(config.voice.dir, f.name);
  if ((await sha256(dest)) === f.sha256) {
    console.log(`✓ ${f.name} is already here`);
    continue;
  }
  console.log(`Downloading ${f.name} (${mb(f.size)}) from ${new URL(f.url).host}…`);
  const res = await fetch(f.url);
  if (!res.ok || !res.body) throw new Error(`${f.url} answered ${res.status}`);
  const part = dest + ".part";
  const hash = createHash("sha256");
  let got = 0;
  let shown = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    got += chunk.length;
    const pct = Math.floor((got / f.size) * 10) * 10;
    if (pct > shown) {
      shown = pct;
      process.stdout.write(` ${pct}%`);
    }
  });
  await pipeline(body, createWriteStream(part));
  process.stdout.write("\n");
  if (hash.digest("hex") !== f.sha256) {
    await rm(part, { force: true });
    throw new Error(`${f.name} doesn't match its expected checksum; deleted it. Try again later.`);
  }
  await rename(part, dest);
  console.log(`✓ ${f.name}`);
}
console.log(`\nKokoro is ready in ${config.voice.dir}. Restart Lei and pick a voice in Settings.`);
console.log("For Spanish and Portuguese voices, also install espeak-ng (on a Mac: brew install espeak-ng).");
