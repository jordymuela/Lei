// Thin client for the Lei server's JSON API.

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function call(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("offline", "Can't reach the Lei server.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || "server", data.message || data.error || res.statusText);
  return data;
}

export const api = {
  state: () => call("GET", "/api/state"),
  setup: (answers) => call("POST", "/api/setup", answers),
  rename: (companionName) => call("PATCH", "/api/profile", { companionName }),
  forget: (id) => call("DELETE", "/api/memories/" + encodeURIComponent(id)),
  clearTranscript: () => call("DELETE", "/api/transcript"),
  reset: () => call("DELETE", "/api/state"),
};

/**
 * Streams one reply. `body` is { text } for a new message, { retry: true } to
 * answer the last message again, or { nudge: "welcome-back" }. Each event
 * line from the server is passed to `onEvent` (see ChatEvent in server/types.ts).
 * Rejects with an AbortError when `signal` aborts.
 */
export async function chatStream(body, { signal, onEvent }) {
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("offline", "Can't reach the Lei server.");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError("server", data.error || res.statusText);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
}
