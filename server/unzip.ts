// Reads one file out of a zip archive (a Python wheel, for the Smart Turn
// model) using the central directory, so sizes are right even when the local
// headers leave them out. Stored and deflated entries only; no Zip64.

import { inflateRawSync } from "node:zlib";

export function readZipEntry(zip: Buffer, name: string): Buffer {
  const min = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= min; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file");
  const entries = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("Damaged zip directory");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`${name} uses an unsupported compression method (${method})`);
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${name} isn't in the archive`);
}
