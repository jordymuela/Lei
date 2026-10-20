import assert from "node:assert/strict";
import { test } from "node:test";
import { hostname, refuseReason } from "../server/security.ts";

const local = { host: "127.0.0.1:3000" };

test("hostname strips the port, IPv6 included", () => {
  assert.equal(hostname("localhost:3000"), "localhost");
  assert.equal(hostname("[::1]:3000"), "[::1]");
});

test("reads are allowed only when addressed to localhost", () => {
  assert.equal(refuseReason("GET", local, "127.0.0.1"), null);
  assert.match(refuseReason("GET", { host: "evil.example:3000" }, "127.0.0.1") ?? "", /localhost/);
  assert.equal(refuseReason("GET", { host: "192.168.1.5:3000" }, "0.0.0.0"), null);
});

test("writes must come from this page, as JSON", () => {
  const json = { ...local, "content-type": "application/json" };
  assert.equal(refuseReason("POST", { ...json, origin: "http://127.0.0.1:3000" }, "127.0.0.1"), null);
  assert.equal(refuseReason("POST", json, "127.0.0.1"), null);
  assert.match(refuseReason("POST", { ...json, origin: "https://evil.example" }, "127.0.0.1") ?? "", /other websites/);
  assert.match(refuseReason("POST", { ...json, "sec-fetch-site": "cross-site" }, "127.0.0.1") ?? "", /other websites/);
  assert.match(refuseReason("POST", { ...local, "content-type": "text/plain" }, "127.0.0.1") ?? "", /JSON/);
  assert.equal(refuseReason("DELETE", local, "127.0.0.1"), null);
});
