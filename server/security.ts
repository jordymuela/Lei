import type { IncomingHttpHeaders } from "node:http";

// The server can read your files and spend your Claude credits, so it only
// answers the page it serves. Three checks:
// - Host: while it listens on localhost, requests must be addressed to
//   localhost. That blocks DNS-rebinding attacks, where a website points its
//   own hostname at 127.0.0.1.
// - Origin: requests that change something must come from this page.
//   Other websites can't post here or read the answers.
// - WebSockets (the mic stream) must come from this page too. Browsers let
//   any website open a WebSocket to localhost, so the Origin check is required.

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** "localhost:3000" -> "localhost"; "[::1]:3000" -> "[::1]". */
export function hostname(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/** Returns why a request must be refused, or null when it may go ahead. */
export function refuseReason(method: string, headers: IncomingHttpHeaders, bindHost: string): string | null {
  const host = headers.host ?? "";
  if (LOOPBACK.has(bindHost) && !LOOPBACK.has(hostname(host))) return "This server only answers requests addressed to localhost.";
  if (method === "GET" || method === "HEAD") return null;
  if (headers["sec-fetch-site"] === "cross-site") return "Requests from other websites aren't allowed.";
  const origin = headers.origin;
  if (origin && origin !== `http://${host}`) return "Requests from other websites aren't allowed.";
  if ((method === "POST" || method === "PATCH") && !String(headers["content-type"] ?? "").startsWith("application/json")) {
    return "Send JSON with Content-Type: application/json.";
  }
  return null;
}

/** Like refuseReason, for a WebSocket upgrade: the Origin must be this page, and it must be present. */
export function refuseUpgrade(headers: IncomingHttpHeaders, bindHost: string): string | null {
  const host = headers.host ?? "";
  if (LOOPBACK.has(bindHost) && !LOOPBACK.has(hostname(host))) return "This server only answers requests addressed to localhost.";
  if (headers.origin !== `http://${host}` || headers["sec-fetch-site"] === "cross-site") return "Connections from other websites aren't allowed.";
  return null;
}
