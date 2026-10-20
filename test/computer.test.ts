import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findFiles, isSecretPath, listDirectory, openTarget, readTextFile, resolveInRoot } from "../server/computer.ts";

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "lei-root-"));
  await mkdir(path.join(root, "docs", "2026"), { recursive: true });
  await writeFile(path.join(root, "docs", "2026", "invoice-march.txt"), "Total: 120");
  await writeFile(path.join(root, "docs", ".env"), "API_KEY=secret");
  await mkdir(path.join(root, ".ssh"));
  await writeFile(path.join(root, ".ssh", "id_ed25519"), "PRIVATE");
  return root;
}

test("paths outside the root or holding secrets are refused", async () => {
  const root = await workspace();
  assert.equal(resolveInRoot(root, "docs"), path.join(root, "docs"));
  assert.throws(() => resolveInRoot(root, "../etc/passwd"), /outside the folder/);
  assert.throws(() => resolveInRoot(root, "/etc/passwd"), /outside the folder/);
  assert.throws(() => resolveInRoot(root, ".ssh/id_ed25519"), /passwords or keys/);
  assert.throws(() => resolveInRoot(root, "docs/.env"), /passwords or keys/);
  assert.ok(isSecretPath("/home/a/.aws/credentials"));
  assert.ok(isSecretPath("/home/a/certs/server.pem"));
  assert.ok(!isSecretPath("/home/a/docs/environment-notes.txt"));
});

test("list, find and read stay inside the root and skip secrets", async () => {
  const root = await workspace();
  const listing = JSON.parse(await listDirectory(root, "docs"));
  assert.deepEqual(listing.entries.map((e: { name: string }) => e.name), ["2026/", ".env"]);
  const found = JSON.parse(await findFiles(root, "invoice"));
  assert.equal(found.matches.length, 1);
  assert.match(found.matches[0], /invoice-march\.txt$/);
  assert.equal(JSON.parse(await findFiles(root, "env")).matches.length, 0);
  assert.equal(await readTextFile(root, "docs/2026/invoice-march.txt"), "Total: 120");
  await assert.rejects(readTextFile(root, "docs/.env"), /passwords or keys/);
  await assert.rejects(readTextFile(root, "docs/missing.txt"), /No file/);
});

test("open refuses files and apps", async () => {
  const root = await workspace();
  const ctx = { root, platform: process.platform };
  await assert.rejects(openTarget(ctx, "docs/2026/invoice-march.txt"), /not files or apps/);
  await assert.rejects(openTarget(ctx, "Spotify"), /not files or apps/);
  await assert.rejects(openTarget(ctx, "javascript:alert(1)"), /not files or apps/);
});
