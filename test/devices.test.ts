import assert from "node:assert/strict";
import { test } from "node:test";
import { COOKIE, Pairing, findDevice, newDevice, readCookie, sessionCookie } from "../server/devices.ts";
import { refuseRemote, refuseRemoteUpgrade } from "../server/security.ts";
import { emptyState } from "../server/store.ts";

test("a pairing code works once, expires, and dies after five wrong tries", () => {
  const p = new Pairing();
  const { code } = p.newCode(0);
  assert.match(code, /^\d{6}$/);
  assert.ok(p.redeem(code.slice(0, 3) + " " + code.slice(3), 1000), "spaces are ignored");
  assert.ok(!p.redeem(code, 1000), "only once");

  const late = p.newCode(0).code;
  assert.ok(!p.redeem(late, 5 * 60_000 + 1), "expired");

  const guessed = p.newCode(0).code;
  const wrong = guessed === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.ok(!p.redeem(wrong, 10));
  assert.ok(!p.redeem(guessed, 10), "closed after five wrong tries");
});

test("a device is found by its cookie, and only its token's hash is stored", () => {
  const state = emptyState();
  const { device, token } = newDevice("Jordy's iPhone", 5);
  state.devices.push(device);
  assert.ok(!JSON.stringify(state).includes(token));
  assert.equal(findDevice(state, `theme=dark; ${COOKIE}=${token}`)?.name, "Jordy's iPhone");
  assert.equal(findDevice(state, `${COOKIE}=wrong`), null);
  assert.equal(findDevice(state, undefined), null);
  assert.equal(readCookie("a=1; b = two ", "b"), "two");
  assert.match(sessionCookie(token), /HttpOnly; Secure; SameSite=Strict/);
});

test("the remote port answers only its own name, never Funnel, and writes only from its page", () => {
  const hosts = ["lei-mac.tail1234.ts.net"];
  const h = { host: "lei-mac.tail1234.ts.net" };
  const json = { ...h, "content-type": "application/json" };
  assert.equal(refuseRemote("GET", h, hosts), null);
  assert.match(refuseRemote("GET", { host: "localhost:3001" }, hosts) ?? "", /isn't one Lei answers to/);
  assert.match(refuseRemote("GET", { host: "evil.example" }, hosts) ?? "", /isn't one Lei answers to/);
  assert.match(refuseRemote("GET", { ...h, "tailscale-funnel-request": "?1" }, hosts) ?? "", /public internet/);
  assert.equal(refuseRemote("POST", { ...json, origin: "https://lei-mac.tail1234.ts.net" }, hosts), null);
  assert.match(refuseRemote("POST", { ...json, origin: "https://evil.example" }, hosts) ?? "", /other websites/);
  assert.match(refuseRemote("POST", { ...h, "content-type": "text/plain" }, hosts) ?? "", /JSON/);
  assert.equal(refuseRemoteUpgrade({ ...h, origin: "https://lei-mac.tail1234.ts.net" }, hosts), null);
  assert.match(refuseRemoteUpgrade(h, hosts) ?? "", /other websites/);
});
