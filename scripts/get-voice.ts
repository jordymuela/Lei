// Downloads Lei's open-source models into data/voices (or LEI_VOICE_DIR):
// - Kokoro, her voice (about 350 MB);
// - Silero VAD and Parakeet, speech recognition that runs on this computer
//   (about 490 MB to download, 660 MB unpacked).
// Every file is checked against its pinned SHA-256 before it's used or
// unpacked, so a tampered or truncated download is never loaded. Safe to run
// again: what's already right is skipped. `--voice` or `--hearing` fetches one half.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "../server/config.ts";
import { HEARING_FILES } from "../server/hearing.ts";
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

const only = process.argv.includes("--voice") ? "voice" : process.argv.includes("--hearing") ? "hearing" : "";
const files: { name: string; size: number; sha256: string; url: string; unpacksTo?: string }[] = [
  ...(only !== "hearing" ? KOKORO_FILES : []),
  ...(only !== "voice" ? HEARING_FILES : []),
];

await mkdir(config.voice.dir, { recursive: true });
for (const f of files) {
  const dest = path.join(config.voice.dir, f.name);
  if (f.unpacksTo && existsSync(path.join(config.voice.dir, f.unpacksTo, "tokens.txt"))) {
    console.log(`✓ ${f.unpacksTo} is already here`);
    continue;
  }
  if ((await sha256(dest)) === f.sha256 && !f.unpacksTo) {
    console.log(`✓ ${f.name} is already here`);
    continue;
  }
  if ((await sha256(dest)) !== f.sha256) await download(f, dest);
  if (f.unpacksTo) {
    console.log(`Unpacking ${f.name}…`);
    execFileSync("tar", ["-xjf", dest, "-C", config.voice.dir], { stdio: "inherit" });
    await rm(dest);
  }
  console.log(`✓ ${f.unpacksTo ?? f.name}`);
}
console.log(`\nReady in ${config.voice.dir}. Restart Lei, then pick a voice in Settings.`);
if (only !== "hearing") console.log("For Spanish and Portuguese voices, also install espeak-ng (on a Mac: brew install espeak-ng).");

/** Streams one file to disk while hashing it; keeps it only if the hash matches. */
async function download(f: { name: string; size: number; sha256: string; url: string }, dest: string): Promise<void> {
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
}
