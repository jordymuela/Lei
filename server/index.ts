import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { SetupError, nameCompanion, runTurn } from "./chat.ts";
import type { ApprovalRequest } from "./computer.ts";
import { config } from "./config.ts";
import { welcomeBackNudge } from "./prompt.ts";
import { ReminderClock } from "./reminders.ts";
import { refuseReason } from "./security.ts";
import { LIMITS, Store, addMessage } from "./store.ts";
import { createVoice, kokoroInstalled } from "./tts.ts";
import type { ChatEvent, Reminder, State } from "./types.ts";

const client = new Anthropic();
const store = new Store(config.dataFile);
const voice = await createVoice(config);

/** Open pages listening on GET /api/events (server-sent events), for reminders. */
const listeners = new Set<ServerResponse>();
function deliverReminder(r: Reminder): boolean {
  for (const res of listeners) res.write(`event: reminder\ndata: ${JSON.stringify(r)}\n\n`);
  return listeners.size > 0;
}
const reminders = new ReminderClock(store, deliverReminder);

/**
 * Actions waiting for the person's OK, by id. Each resolves once: Allow or
 * Deny from the page (POST /api/approve), or "no" after two minutes without
 * an answer or when the turn is interrupted.
 */
const APPROVAL_TIMEOUT_MS = 120_000;
const pendingApprovals = new Map<string, (allow: boolean) => void>();

function requestApproval(request: ApprovalRequest, send: (e: ChatEvent) => void, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const id = randomUUID();
    const finish = (allow: boolean) => {
      if (!pendingApprovals.delete(id)) return;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      send({ type: "approval_result", id, allow });
      resolve(allow);
    };
    const timer = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
    const onAbort = () => finish(false);
    signal.addEventListener("abort", onAbort, { once: true });
    pendingApprovals.set(id, finish);
    send({ type: "approval", approval: { id, ...request } });
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "Body too large");
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, "Expected a JSON object");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const publicState = (s: State) => ({
  profile: s.profile,
  memories: s.memories,
  transcript: s.transcript,
  corrections: s.corrections,
  voice: voice ? "server" : "browser",
  voiceEngine: voice?.name ?? null,
  voices: voice?.voices ?? [],
  mode: config.mode,
  // In practice mode the page speaks the learner's language and listens for the target one.
  ui: config.mode === "practice" ? config.practice.native : null,
  speechLang: config.mode === "practice" ? config.practice.target : null,
});

/** Maps an Anthropic API error to a code the page knows how to explain. */
function errorCode(err: unknown): { code: string; message: string } {
  if (err instanceof Anthropic.AuthenticationError) return { code: "auth", message: "Claude rejected the credentials." };
  if (err instanceof Anthropic.PermissionDeniedError) return { code: "auth", message: "These credentials can't use this model." };
  if (err instanceof Anthropic.RateLimitError) return { code: "rate_limited", message: "Rate limited by the Claude API." };
  if (err instanceof Anthropic.BadRequestError) return { code: "bad_request", message: err.message };
  if (err instanceof Anthropic.APIConnectionError) return { code: "network", message: "Couldn't reach the Claude API." };
  if (err instanceof Anthropic.APIError) return { code: "upstream", message: err.message };
  // Raised by the SDK before any request is sent, most often because no credentials were found.
  if (err instanceof Anthropic.AnthropicError) return { code: "config", message: err.message };
  if (err instanceof SetupError) return { code: "setup", message: err.message };
  return { code: "server", message: err instanceof Error ? err.message : String(err) };
}

/** POST /api/chat: streams one reply as NDJSON (see ChatEvent). */
async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  const state = await store.load();
  if (!state.profile) throw new HttpError(409, "Finish setup first");

  const text = str(body.text, LIMITS.messageChars);
  let nudge: string | undefined;
  if (text) {
    await store.update((s) => addMessage(s, { role: "user", text, at: Date.now() }));
  } else if (body.retry === true) {
    if (state.transcript[state.transcript.length - 1]?.role !== "user") throw new HttpError(409, "Nothing to answer");
  } else if (body.nudge === "welcome-back") {
    const last = state.transcript[state.transcript.length - 1];
    if (!last) throw new HttpError(409, "Nothing to come back to");
    nudge = welcomeBackNudge(state.profile, Date.now() - last.at, config.mode === "practice");
  } else {
    throw new HttpError(400, "Send text, retry, or a nudge");
  }

  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  const send = (e: ChatEvent) => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(e) + "\n");
  };
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  const startedAt = Date.now();
  try {
    const result = await runTurn({
      client,
      config,
      store,
      nudge,
      signal: abort.signal,
      on: {
        text: (delta) => send({ type: "text", delta }),
        memory: (memory) => send({ type: "memory", memory }),
        song: (song) => send({ type: "song", song }),
        correction: (correction) => send({ type: "correction", correction }),
        activity: (activity) => send({ type: "activity", activity }),
        reminderSet: (reminder) => send({ type: "reminder_set", reminder }),
        approve: (request) => requestApproval(request, send, abort.signal),
      },
    });
    let saved = null;
    if (result.end !== "refused" && (result.text.trim() || result.song)) {
      saved = { role: "assistant" as const, text: result.text.trim(), at: startedAt, ...(result.song ? { song: result.song } : {}) };
      await store.update((s) => addMessage(s, saved!));
    }
    if (result.end === "refused") send({ type: "error", code: "refused", message: "Declined to answer." });
    else if (result.end !== "aborted") send({ type: "done", message: saved });
  } catch (err) {
    const { code, message } = errorCode(err);
    console.error(`[chat] ${code}: ${message}`);
    send({ type: "error", code, message });
  }
  res.end();
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;
  const m = req.method ?? "GET";

  if (p.startsWith("/api/")) {
    const refused = refuseReason(m, req.headers, config.host);
    if (refused) throw new HttpError(403, refused);
  }

  if (p === "/api/events" && m === "GET") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": connected\n\n");
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    res.on("close", () => {
      clearInterval(ping);
      listeners.delete(res);
    });
    await reminders.deliverPending();
    return;
  }

  if (p === "/api/state" && m === "GET") return sendJson(res, 200, publicState(await store.load()));

  if (p === "/api/state" && m === "DELETE") return sendJson(res, 200, publicState(await store.reset()));

  if (p === "/api/setup" && m === "POST") {
    const body = await readJson(req);
    const level = ["beginner", "intermediate", "advanced"].includes(String(body.level)) ? String(body.level) : "";
    const answers = {
      userName: str(body.userName, 40),
      about: str(body.about, 200),
      onMind: str(body.onMind, 600),
      level,
      goal: str(body.goal, 300),
    };
    if (!answers.userName) throw new HttpError(400, "A name is required");
    try {
      const { name, greeting } = await nameCompanion(client, config, answers);
      const now = Date.now();
      await store.reset();
      const state = await store.update((s) => {
        s.profile = { ...answers, companionName: name, createdAt: now };
        addMessage(s, { role: "assistant", text: greeting, at: now });
      });
      return sendJson(res, 200, publicState(state));
    } catch (err) {
      const { code, message } = errorCode(err);
      console.error(`[setup] ${code}: ${message}`);
      return sendJson(res, 502, { error: code, message });
    }
  }

  if (p === "/api/chat" && m === "POST") return chat(req, res);

  if (p === "/api/approve" && m === "POST") {
    const body = await readJson(req);
    const finish = pendingApprovals.get(String(body.id ?? ""));
    if (!finish) throw new HttpError(404, "Nothing is waiting for approval with that id");
    finish(body.allow === true);
    return sendJson(res, 200, { ok: true });
  }

  if (p === "/api/profile" && m === "PATCH") {
    const body = await readJson(req);
    const name = str(body.companionName, 20);
    const state = await store.update((s) => {
      if (!s.profile) throw new HttpError(409, "Finish setup first");
      if (name) s.profile.companionName = name;
    });
    return sendJson(res, 200, publicState(state));
  }

  const memory = /^\/api\/memories\/([\w-]+)$/.exec(p);
  if (memory && m === "DELETE") {
    const state = await store.update((s) => {
      s.memories = s.memories.filter((x) => x.id !== memory[1]);
    });
    return sendJson(res, 200, publicState(state));
  }

  if (p === "/api/transcript" && m === "DELETE") {
    const state = await store.update((s) => {
      s.transcript = [];
    });
    return sendJson(res, 200, publicState(state));
  }

  if (p === "/api/tts" && m === "POST") {
    if (!voice) throw new HttpError(404, "Server voice isn't configured");
    const body = await readJson(req);
    const text = str(body.text, 1000);
    if (!text) throw new HttpError(400, "Nothing to say");
    const asked = str(body.voice, 80);
    const id = voice.voices.some((v) => v.id === asked) ? asked : voice.voices[0].id;
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let audio: Response;
    try {
      audio = await voice.speak(text, id, abort.signal);
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(`[voice] ${err instanceof Error ? err.message : err}`);
      throw new HttpError(502, "The voice couldn't say that");
    }
    res.writeHead(200, { "content-type": audio.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store" });
    if (!audio.body) return void res.end();
    Readable.fromWeb(audio.body as import("node:stream/web").ReadableStream).pipe(res);
    return;
  }

  if (p.startsWith("/api/")) throw new HttpError(404, "Not found");
  if (m !== "GET" && m !== "HEAD") throw new HttpError(405, "Method not allowed");
  return serveStatic(p, res);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.resolve(config.publicDir, rel);
  if (path.relative(config.publicDir, file).startsWith("..")) throw new HttpError(404, "Not found");
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, "Not found");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: err instanceof Error ? err.message : "Server error" });
  });
});

server.listen(config.port, config.host, () => {
  reminders.start();
  const voiceName = voice ? `voice: ${voice.name}` : "browser voices";
  console.log(`Lei is listening on http://${config.host}:${config.port}  (model ${config.model}, effort ${config.effort}, ${voiceName})`);
  if (!voice && config.voice.engine === "auto" && !kokoroInstalled(config)) {
    console.log("For a natural open-source voice that runs on this computer, run: npm run get-voice");
  }
  if (config.mode === "companion" && config.computer) {
    console.log(
      `Can look through ${config.workspace}${config.web ? " and search the web" : ""}; commands, file writes and apps wait for your OK. Set LEI_COMPUTER=off to turn this off.`,
    );
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("No ANTHROPIC_API_KEY set; using an `ant auth login` profile if there is one.");
  }
});
