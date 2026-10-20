import { spawn } from "node:child_process";
import { readFile, readdir, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Lei's view of the computer it runs on. Everything here is read-only:
// check the machine, list, find and read files, and open web pages or
// folders. Nothing runs commands, writes files or launches programs.
// File tools are confined to one root folder (LEI_WORKSPACE, the home
// folder by default), and secrets such as SSH keys and .env files are off limits.

/** What the page shows while a tool runs, e.g. { kind: "read", target: "~/notes.txt" }. */
export interface Activity {
  kind: "search" | "fetch" | "status" | "list" | "find" | "read" | "open" | "reminder";
  target: string;
}

export interface ComputerContext {
  root: string;
  platform: NodeJS.Platform;
}

const MAX_READ = 20000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(["node_modules", ".git", "Library", "AppData", "$RECYCLE.BIN", ".Trash", ".cache"]);

/** Folders and files that hold credentials; never listed into or read. */
const SECRET_DIRS = new Set([".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".password-store", "Keychains", ".config/gcloud"]);
const SECRET_FILE = /^(\.env(\..*)?|id_[a-z0-9_]+(\.pub)?|.*\.(pem|key|p12|pfx|keychain-db|kdbx)|\.netrc|\.npmrc|\.pypirc|credentials(\.json)?)$/i;

export class ToolError extends Error {}

/** True for paths that likely hold secrets (SSH keys, cloud credentials, .env files). */
export function isSecretPath(full: string): boolean {
  const parts = full.split(/[\\/]+/);
  if (parts.some((part, i) => SECRET_DIRS.has(part) || SECRET_DIRS.has(parts.slice(i, i + 2).join("/")))) return true;
  return SECRET_FILE.test(parts.at(-1) ?? "");
}

/**
 * Resolves a path the model gave (absolute, relative to the root, or starting
 * with ~) and refuses anything outside the root or holding secrets.
 */
export function resolveInRoot(root: string, p: string): string {
  const raw = String(p ?? "").trim() || ".";
  const expanded = raw === "~" ? os.homedir() : raw.startsWith("~/") || raw.startsWith("~\\") ? path.join(os.homedir(), raw.slice(2)) : raw;
  const full = path.resolve(root, expanded);
  const rel = path.relative(root, full);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new ToolError(`"${raw}" is outside the folder Lei may use (${root}).`);
  }
  if (isSecretPath(full)) throw new ToolError(`"${raw}" may hold passwords or keys, so Lei doesn't read it.`);
  return full;
}

/** A path as the person would say it: ~/Documents/notes.txt. */
export function displayPath(full: string): string {
  const home = os.homedir();
  return full === home ? "~" : full.startsWith(home + path.sep) ? "~" + full.slice(home.length) : full;
}

export async function systemStatus(root: string): Promise<string> {
  const gb = (n: number) => Math.round((n / 1024 ** 3) * 10) / 10;
  let disk = "unknown";
  try {
    const s = await statfs(root);
    disk = `${gb(s.bavail * s.bsize)} GB free of ${gb(s.blocks * s.bsize)} GB`;
  } catch {}
  return JSON.stringify({
    os: `${os.type()} ${os.release()} (${process.platform})`,
    computerName: os.hostname(),
    uptimeHours: Math.round(os.uptime() / 360) / 10,
    cpus: os.cpus().length,
    loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
    memory: `${gb(os.freemem())} GB free of ${gb(os.totalmem())} GB`,
    disk,
  });
}

export async function listDirectory(root: string, p: string): Promise<string> {
  const dir = resolveInRoot(root, p);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => {
    throw new ToolError(`Can't open folder ${displayPath(dir)}.`);
  });
  const rows = await Promise.all(
    entries.slice(0, 300).map(async (e) => {
      const full = path.join(dir, e.name);
      const info = await stat(full).catch(() => null);
      return {
        name: e.name + (e.isDirectory() ? "/" : ""),
        size: e.isFile() ? info?.size : undefined,
        modified: info ? new Date(info.mtimeMs).toISOString().slice(0, 16).replace("T", " ") : undefined,
      };
    }),
  );
  rows.sort((a, b) => Number(b.name.endsWith("/")) - Number(a.name.endsWith("/")) || a.name.localeCompare(b.name));
  return JSON.stringify({ folder: displayPath(dir), count: entries.length, entries: rows });
}

/** Finds files and folders whose name contains `query` (case-insensitive), breadth-first. */
export async function findFiles(root: string, query: string, p = "."): Promise<string> {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new ToolError('"query" must be a non-empty string.');
  const start = resolveInRoot(root, p);
  const found: string[] = [];
  const queue: [string, number][] = [[start, 0]];
  let visited = 0;
  while (queue.length && found.length < 50 && visited < 4000) {
    const [dir, depth] = queue.shift()!;
    visited++;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (isSecretPath(full)) continue;
      if (e.name.toLowerCase().includes(needle)) found.push(displayPath(full) + (e.isDirectory() ? "/" : ""));
      if (e.isDirectory() && depth < 6 && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) queue.push([full, depth + 1]);
    }
  }
  return JSON.stringify({ query, searchedFrom: displayPath(start), matches: found.slice(0, 50), complete: queue.length === 0 });
}

export async function readTextFile(root: string, p: string, maxChars = MAX_READ): Promise<string> {
  const file = resolveInRoot(root, p);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new ToolError(`No file at ${displayPath(file)}.`);
  if (info.size > MAX_FILE_BYTES) throw new ToolError(`${displayPath(file)} is ${Math.round(info.size / 1024)} KB; too big to read.`);
  const buf = await readFile(file);
  if (buf.subarray(0, 8000).includes(0)) throw new ToolError(`${displayPath(file)} isn't a text file.`);
  const text = buf.toString("utf8");
  const limit = Math.max(500, Math.min(MAX_READ, Number(maxChars) || MAX_READ));
  return text.length > limit ? text.slice(0, limit) + `\n[…${text.length - limit} more characters]` : text;
}

/**
 * Opens a web page (http or https) in the default browser, or a folder in
 * the file manager. Files and apps are not opened: opening a file can run it.
 */
export async function openTarget(ctx: ComputerContext, target: string): Promise<string> {
  const t = String(target ?? "").trim();
  if (!t) throw new ToolError('"target" must be a non-empty string.');
  let arg: string;
  let what: string;
  if (/^https?:\/\/\S+$/i.test(t)) {
    arg = t;
    what = t;
  } else {
    const dir = resolveInRoot(ctx.root, t);
    if (!(await stat(dir).catch(() => null))?.isDirectory()) {
      throw new ToolError("Lei can open web pages (https://…) and folders, but not files or apps.");
    }
    arg = dir;
    what = displayPath(dir);
  }
  const p = ctx.platform;
  const [cmd, args] = p === "darwin" ? ["open", [arg]] : p === "win32" ? ["explorer.exe", [arg]] : ["xdg-open", [arg]];
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (err) => resolve(`Couldn't open ${what}: ${err.message}`));
    // The opener hands off and exits quickly. explorer.exe exits with 1 even when it works, so only trust 0 elsewhere.
    const timer = setTimeout(() => {
      child.unref();
      resolve(`Opened ${what}.`);
    }, 5000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 || p === "win32" ? `Opened ${what}.` : `Couldn't open ${what} (exit code ${code}).`);
    });
  });
}
