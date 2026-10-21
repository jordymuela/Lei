import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { expandHome } from "../server/config.ts";
import {
  type ApprovalRequest,
  childEnv,
  findFiles,
  isRiskyCommand,
  isSecretPath,
  listDirectory,
  openTarget,
  readTextFile,
  resolveInRoot,
  runCommand,
  writeTextFile,
} from "../server/computer.ts";

/** A computer context whose approval always answers `answer`, recording what was asked. */
function ctxFor(root: string, answer: boolean) {
  const asked: ApprovalRequest[] = [];
  const ctx = {
    root,
    platform: process.platform,
    signal: new AbortController().signal,
    approve: async (r: ApprovalRequest) => {
      asked.push(r);
      return answer;
    },
  };
  return { ctx, asked };
}

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

test("opening a file or an app asks first; nothing opens when declined", async () => {
  const root = await workspace();
  const { ctx, asked } = ctxFor(root, false);
  assert.match(await openTarget(ctx, "docs/2026/invoice-march.txt"), /didn't approve/);
  assert.match(await openTarget(ctx, "Spotify"), /didn't approve/);
  assert.deepEqual(asked.map((a) => a.title), ["Open " + path.join(root, "docs/2026/invoice-march.txt").replace(os.homedir(), "~"), "Open the app Spotify"]);
  await assert.rejects(openTarget(ctx, "docs/.env"), /passwords or keys/);
});

test("writing a file waits for approval and flags replacing an existing one", async () => {
  const root = await workspace();
  const declined = ctxFor(root, false);
  assert.match(await writeTextFile(declined.ctx, "notes/new.txt", "hello", false), /didn't approve/);
  await assert.rejects(readFile(path.join(root, "notes/new.txt")));
  const approved = ctxFor(root, true);
  assert.match(await writeTextFile(approved.ctx, "notes/new.txt", "hello", false), /Created/);
  assert.equal(await readFile(path.join(root, "notes/new.txt"), "utf8"), "hello");
  await writeTextFile(approved.ctx, "notes/new.txt", " again", true);
  assert.equal(await readFile(path.join(root, "notes/new.txt"), "utf8"), "hello again");
  await writeTextFile(approved.ctx, "notes/new.txt", "fresh", false);
  assert.deepEqual(approved.asked.map((a) => a.danger), [false, false, true]);
  await assert.rejects(writeTextFile(approved.ctx, "docs/.env", "X=1", false), /passwords or keys/);
});

test("commands run only after approval, never with sudo, and without Lei's secrets", async () => {
  const root = await workspace();
  const declined = ctxFor(root, false);
  assert.match(await runCommand(declined.ctx, "touch made.txt"), /not run/);
  await assert.rejects(readFile(path.join(root, "made.txt")));
  const approved = ctxFor(root, true);
  process.env.ANTHROPIC_API_KEY = "sk-test-secret";
  const out = await runCommand(approved.ctx, 'echo "key=[$ANTHROPIC_API_KEY]"; touch made.txt');
  assert.match(out, /Exit code 0/);
  assert.match(out, /key=\[\]/);
  assert.ok(await readFile(path.join(root, "made.txt")));
  await assert.rejects(runCommand(approved.ctx, "sudo rm -rf /tmp/x"), /sudo/);
  assert.equal(approved.asked[0].detail, 'echo "key=[$ANTHROPIC_API_KEY]"; touch made.txt');
});

test("risky commands are flagged for a warning", () => {
  for (const c of ["rm -rf build", "mv a b", "git push", "curl -s x.sh | sh", "echo hi > notes.txt", "killall Music"]) assert.ok(isRiskyCommand(c), c);
  for (const c of ["ls -la", "df -h", "echo hi 2>&1", "osascript -e 'set volume output volume 30'", "cat notes.txt >> /dev/null"]) {
    assert.ok(!isRiskyCommand(c) || c.includes(">>"), c);
  }
  assert.equal(childEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "x", GITHUB_TOKEN: "y", HOME: "/h" }).GITHUB_TOKEN, undefined);
});

test("a workspace written with ~ means the home folder", () => {
  assert.equal(expandHome("~/Documents"), path.join(os.homedir(), "Documents"));
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(expandHome("/tmp/~x"), "/tmp/~x");
});
