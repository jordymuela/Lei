// Your phone and other computers reach Lei through `tailscale serve`, on a
// second port (LEI_REMOTE_PORT). The Mac's own browser on localhost needs no
// login, but every request on that port must come from a paired device:
// - The Mac's page shows a one-time six-digit code (Settings → Devices).
// - The device enters it at /pair.html and gets a random token in an
//   HttpOnly, Secure, SameSite=Strict cookie. Only the token's hash is stored.
// - Removing a device from the list signs it out at once.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Device, State } from "./types.ts";

export const COOKIE = "lei_device";
const CODE_TTL_MS = 5 * 60_000;
const MAX_TRIES = 5;
const YEAR_S = 365 * 24 * 60 * 60;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The one pairing code that may be open at a time. */
export class Pairing {
  #open: { code: string; expires: number; tries: number } | null = null;

  /** A fresh code, valid for five minutes; it replaces any earlier one. */
  newCode(now = Date.now()): { code: string; expires: number } {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.#open = { code, expires: now + CODE_TTL_MS, tries: 0 };
    return { code, expires: now + CODE_TTL_MS };
  }

  /** True once for the right code; it then closes. Five wrong tries close it too. */
  redeem(code: string, now = Date.now()): boolean {
    const open = this.#open;
    if (!open || now > open.expires) {
      this.#open = null;
      return false;
    }
    const given = Buffer.from(code.replace(/\D/g, ""));
    const right = Buffer.from(open.code);
    if (given.length === right.length && timingSafeEqual(given, right)) {
      this.#open = null;
      return true;
    }
    if (++open.tries >= MAX_TRIES) this.#open = null;
    return false;
  }
}

/** A new device and the token it keeps (never stored in clear). */
export function newDevice(name: string, now = Date.now()): { device: Device; token: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, device: { id: randomBytes(8).toString("hex"), name, tokenHash: hashToken(token), createdAt: now, lastSeen: now } };
}

/** One cookie's value from a Cookie header, or "". */
export function readCookie(header: string | undefined, name: string): string {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

/** The paired device a request comes from, or null. */
export function findDevice(state: State, cookieHeader: string | undefined): Device | null {
  const token = readCookie(cookieHeader, COOKIE);
  if (!token) return null;
  const hash = hashToken(token);
  return state.devices.find((d) => d.tokenHash === hash) ?? null;
}

export const sessionCookie = (token: string) => `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${YEAR_S}`;
export const clearedCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

/** What pages may see about a device (never the token hash). */
export const publicDevice = (d: Device, current: Device | null) => ({
  id: d.id,
  name: d.name,
  createdAt: d.createdAt,
  lastSeen: d.lastSeen,
  current: d.id === current?.id,
});
