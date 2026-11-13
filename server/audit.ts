// An append-only log of what was allowed or changed and from which device:
// approvals of actions on the computer, and devices paired or removed. One
// JSON object per line in audit.log, next to the state file. Read it with
// any text editor; nothing in Lei reads it back.

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

let queue: Promise<void> = Promise.resolve();

export function audit(dataFile: string, entry: Record<string, unknown>): void {
  const file = path.join(path.dirname(dataFile), "audit.log");
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n";
  queue = queue
    .then(() => mkdir(path.dirname(file), { recursive: true }))
    .then(() => appendFile(file, line))
    .catch((err) => console.error(`[audit] ${err instanceof Error ? err.message : err}`));
}
