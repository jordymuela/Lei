import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, stat, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Lei's hands on the computer it runs on.
// - Looking needs no permission: check the machine, list, find and read
//   files, open web pages and folders.
// - Changing anything waits for the person's OK, every time: writing a file,
//   running a command, opening a file or an app. The page shows the exact
//   command or file, and nothing happens until they say yes or tap Allow.
// File tools are confined to one root folder (LEI_WORKSPACE, the home folder
// by default), and files holding keys or passwords are off limits even with an OK.

/** What the page shows while a tool runs, e.g. { kind: "read", target: "~/notes.txt" }. */
export interface Activity {
  kind: "search" | "fetch" | "status" | "list" | "find" | "read" | "open" | "reminder" | "write" | "run";
  target: string;
}

/** Shown to the person before an action; `detail` is the exact command or file content. */
export interface ApprovalRequest {
  tool: string;
  title: string;
  detail: string;
  /** True when the action deletes, moves or overwrites things; the page shows a warning. */
  danger: boolean;
}

export interface ComputerContext {
  root: string;
  platform: NodeJS.Platform;
  /** Asks the person; resolves false when they decline, don't answer, or the turn is interrupted. */
  approve(request: ApprovalRequest): Promise<boolean>;
  signal: AbortSignal;
  /**
   * Set once text from outside (a file, a folder listing, command output, a
   * web page or search result) has entered this turn. From then on web links
   * open only with approval: that text could ask her to send data out in a URL.
   */
  untrusted?: boolean;
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
  if (isSecretPath(full)) throw new ToolError(`"${raw}" may hold passwords or keys, so Lei leaves it alone.`);
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

/** Starts a helper program and reports whether it exited cleanly (open, xdg-open). */
function launch(cmd: string, args: string[], what: string, trustExit: boolean): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (err) => resolve(`Couldn't open ${what}: ${err.message}`));
    // The opener hands off and exits quickly; if it doesn't, assume it worked.
    const timer = setTimeout(() => {
      child.unref();
      resolve(`Opened ${what}.`);
    }, 5000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 || !trustExit ? `Opened ${what}.` : `Couldn't open ${what} (exit code ${code}).`);
    });
  });
}

/**
 * Opens a web page or a folder straight away. A file or an app needs the
 * person's OK first, because opening one can run code.
 */
export async function openTarget(ctx: ComputerContext, target: string): Promise<string> {
  const t = String(target ?? "").trim();
  if (!t) throw new ToolError('"target" must be a non-empty string.');
  const p = ctx.platform;
  const opener = (arg: string): [string, string[]] =>
    p === "darwin" ? ["open", [arg]] : p === "win32" ? ["explorer.exe", [arg]] : ["xdg-open", [arg]];
  // explorer.exe exits with 1 even when it works, so its exit code isn't trusted.
  const trustExit = p !== "win32";

  if (/^https?:\/\/\S+$/i.test(t)) {
    if (ctx.untrusted) {
      const ok = await ctx.approve({ tool: "open", title: `Open ${new URL(t).host}`, detail: t, danger: false });
      if (!ok) return "The person didn't approve this, so nothing was opened.";
    }
    return launch(...opener(t), t, trustExit);
  }

  let file: string | null = null;
  try {
    file = resolveInRoot(ctx.root, t);
  } catch (err) {
    // A bare name like "Spotify" that isn't a path is treated as an app below.
    if (/[\\/~]/.test(t)) throw err;
  }
  const info = file ? await stat(file).catch(() => null) : null;
  if (file && info?.isDirectory()) return launch(...opener(file), displayPath(file), trustExit);

  if (file && info?.isFile()) {
    const ok = await ctx.approve({ tool: "open", title: `Open ${displayPath(file)}`, detail: displayPath(file), danger: false });
    if (!ok) return "The person didn't approve this, so nothing was opened.";
    return launch(...opener(file), displayPath(file), trustExit);
  }

  // An app by name.
  const ok = await ctx.approve({ tool: "open", title: `Open the app ${t}`, detail: t, danger: false });
  if (!ok) return "The person didn't approve this, so nothing was opened.";
  if (p === "darwin") return launch("open", ["-a", t], `the ${t} app`, true);
  if (p === "win32") return launch("cmd", ["/c", "start", "", t], t, false);
  return launch(t, [], t, false);
}

const MAX_OUTPUT = 8000;
const COMMAND_TIMEOUT_MS = 60_000;

/** Keeps the end of long output, where results and errors usually are. */
export function clip(text: string, max = MAX_OUTPUT): string {
  return text.length <= max ? text : `[…${text.length - max} characters cut…]\n` + text.slice(-max);
}

export async function writeTextFile(ctx: ComputerContext, p: string, content: string, append: boolean): Promise<string> {
  const file = resolveInRoot(ctx.root, p);
  const existing = await stat(file).catch(() => null);
  if (existing?.isDirectory()) throw new ToolError(`${displayPath(file)} is a folder.`);
  const replaces = !!existing && !append;
  const ok = await ctx.approve({
    tool: "write_file",
    title: append ? `Add to ${displayPath(file)}` : replaces ? `Replace ${displayPath(file)}` : `Create ${displayPath(file)}`,
    detail: content.length > 1500 ? content.slice(0, 1500) + `\n… (${content.length} characters in all)` : content,
    danger: replaces,
  });
  if (!ok) return "The person didn't approve this, so nothing was written.";
  await mkdir(path.dirname(file), { recursive: true });
  await (append ? appendFile(file, content) : writeFile(file, content));
  return `${append ? "Added to" : replaces ? "Replaced" : "Created"} ${displayPath(file)} (${content.length} characters).`;
}

/** Commands that delete, move, overwrite or otherwise change things in a way that's hard to undo. */
const RISKY =
  /(^|[\s;&|(])(rm|rmdir|mv|chmod|chown|kill|killall|pkill|shred|srm|truncate|dd|diskutil|launchctl|crontab|trash)\b|\bdefaults\s+(write|delete)\b|\bgit\s+(push|reset|clean|checkout\s+--)\b|\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b|\bbrew\s+(uninstall|remove)\b|\bnpm\s+(publish|uninstall)\b|(^|[^>&0-9])>(?!&|>)|\bosascript\b.*\b(delete|empty trash)\b/i;

export function isRiskyCommand(command: string): boolean {
  return RISKY.test(command);
}

/** Environment for commands, minus Lei's own secrets, so a command can't reveal API keys. */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(ANTHROPIC|ELEVENLABS)_|(_KEY|_TOKEN|_SECRET|_PASSWORD)$/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** The shell and its arguments for one command on this platform. */
export function shellFor(platform: NodeJS.Platform, command: string): [string, string[]] {
  if (platform === "win32") return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]];
  return [process.env.SHELL || "/bin/zsh", ["-c", command]];
}

export async function runCommand(ctx: ComputerContext, command: string, cwd?: string): Promise<string> {
  const cmd = command.trim();
  if (/(^|[\s;&|(])sudo\b/.test(cmd)) {
    throw new ToolError("Lei doesn't run commands with sudo. Ask the person to run it in Terminal themselves.");
  }
  const dir = resolveInRoot(ctx.root, cwd || ".");
  if (!(await stat(dir).catch(() => null))?.isDirectory()) throw new ToolError(`No folder at ${displayPath(dir)}.`);
  const ok = await ctx.approve({ tool: "run_command", title: `Run in ${displayPath(dir)}`, detail: cmd, danger: isRiskyCommand(cmd) });
  if (!ok) return "The person didn't approve this, so the command was not run.";
  const [shell, args] = shellFor(ctx.platform, cmd);
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(shell, args, { cwd: dir, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const collect = (d: Buffer) => {
      out = clip(out + d.toString("utf8"), MAX_OUTPUT * 2);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const stop = () => child.kill();
    const timer = setTimeout(() => {
      out += `\n[Stopped after ${COMMAND_TIMEOUT_MS / 1000} seconds.]`;
      stop();
    }, COMMAND_TIMEOUT_MS);
    ctx.signal.addEventListener("abort", stop, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Couldn't start the command: ${err.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", stop);
      resolve(`Exit code ${code ?? "none"}.\n${clip(out.trim()) || "(no output)"}`);
    });
  });
}
