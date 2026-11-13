import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// Starts the real server with a remote port and talks to it the way
// `tailscale serve` would: plain HTTP on 127.0.0.1, with the phone's Host.
const HOST = "lei-mac.tail1234.ts.net";
const LOCAL = 41000 + Math.floor(Math.random() * 1000);
const REMOTE = LOCAL + 1000;
let server: ChildProcess;
let dir: string;

function request(port: number, method: string, p: string, opts: { host?: string; body?: unknown; cookie?: string } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const host = opts.host ?? (port === REMOTE ? HOST : `127.0.0.1:${port}`);
    const headers: Record<string, string> = { host };
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      headers.origin = port === REMOTE ? `https://${host}` : `http://${host}`;
    }
    if (opts.cookie) headers.cookie = opts.cookie;
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "lei-remote-"));
  server = spawn(process.execPath, ["server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(LOCAL),
      LEI_REMOTE_PORT: String(REMOTE),
      LEI_REMOTE_HOSTS: HOST,
      LEI_DATA_FILE: path.join(dir, "state.json"),
      LEI_VOICE: "browser",
      LEI_HEARING: "browser",
      ANTHROPIC_API_KEY: "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    const t = setTimeout(() => reject(new Error("server didn't start: " + out)), 20000);
    const seen = (d: Buffer) => {
      out += d;
      if (out.includes("Lei is listening") && out.includes("Phones and other computers")) {
        clearTimeout(t);
        resolve();
      }
    };
    server.stdout!.on("data", seen);
    server.stderr!.on("data", seen);
  });
});

after(() => server.kill());

test("an unpaired phone sees only the pairing page", async () => {
  assert.equal((await request(REMOTE, "GET", "/")).headers.location, "/pair.html");
  assert.equal((await request(REMOTE, "GET", "/pair.html")).status, 200);
  assert.equal((await request(REMOTE, "GET", "/js/app.js")).status, 302);
  assert.equal((await request(REMOTE, "GET", "/api/state")).status, 401);
  assert.equal((await request(REMOTE, "GET", "/api/state", { host: "localhost" })).status, 403);
});

test("a phone pairs with the Mac's code, then can use Lei until it's removed", async () => {
  // Codes come only from the Mac itself.
  assert.equal((await request(REMOTE, "POST", "/api/devices/code", { body: {} })).status, 401);
  const made = await request(LOCAL, "POST", "/api/devices/code", { body: {} });
  assert.equal(made.status, 200);
  const { code, url } = JSON.parse(made.body);
  assert.equal(url, `https://${HOST}`);

  assert.equal((await request(REMOTE, "POST", "/api/pair", { body: { code: "000000" === code ? "111111" : "000000", name: "x" } })).status, 403);
  const paired = await request(REMOTE, "POST", "/api/pair", { body: { code, name: "Jordy's iPhone" } });
  assert.equal(paired.status, 200);
  const setCookie = String(paired.headers["set-cookie"]);
  assert.match(setCookie, /lei_device=.+HttpOnly; Secure; SameSite=Strict/);
  const cookie = setCookie.split(";")[0];

  const state = await request(REMOTE, "GET", "/api/state", { cookie });
  assert.equal(state.status, 200);
  assert.equal(JSON.parse(state.body).local, false);
  assert.equal((await request(REMOTE, "GET", "/js/app.js", { cookie })).status, 200);
  // Still can't make codes from the phone.
  assert.equal((await request(REMOTE, "POST", "/api/devices/code", { body: {}, cookie })).status, 403);

  const list = JSON.parse((await request(LOCAL, "GET", "/api/devices")).body);
  assert.equal(list.devices.length, 1);
  assert.equal(list.devices[0].name, "Jordy's iPhone");
  assert.ok(!("tokenHash" in list.devices[0]));

  // The same code can't pair a second device.
  assert.equal((await request(REMOTE, "POST", "/api/pair", { body: { code, name: "thief" } })).status, 403);

  assert.equal((await request(LOCAL, "DELETE", `/api/devices/${list.devices[0].id}`)).status, 200);
  assert.equal((await request(REMOTE, "GET", "/api/state", { cookie })).status, 401);

  // The audit log is written in the background; give it a moment under load.
  let log = "";
  for (let i = 0; i < 40 && !log.includes("device_removed"); i++) {
    log = await readFile(path.join(dir, "audit.log"), "utf8").catch(() => "");
    if (!log.includes("device_removed")) await new Promise((r) => setTimeout(r, 50));
  }
  assert.match(log, /"event":"device_paired","device":"Jordy's iPhone"/);
  assert.match(log, /"event":"device_removed","device":"Jordy's iPhone","by":"this computer"/);
});

test("Funnel traffic from the public internet is refused", async () => {
  const res = await new Promise<number>((resolve) => {
    http.get({ host: "127.0.0.1", port: REMOTE, path: "/pair.html", headers: { host: HOST, "tailscale-funnel-request": "?1" } }, (r) => resolve(r.statusCode ?? 0));
  });
  assert.equal(res, 403);
});
