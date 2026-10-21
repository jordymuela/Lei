import Anthropic from "@anthropic-ai/sdk";
import { type Config, useFallbacks } from "./config.ts";
import {
  NAMING_SCHEMA,
  type SetupAnswers,
  cleanName,
  contextPrompt,
  historyMessages,
  namingPrompt,
  personaPrompt,
  practiceNamingPrompt,
  practicePrompt,
} from "./prompt.ts";
import os from "node:os";
import { type Activity, type ApprovalRequest, displayPath } from "./computer.ts";
import { type Store, addCorrection, addMemory } from "./store.ts";
import { COMPUTER_TOOL_NAMES, runComputerTool, runTool, toolsFor } from "./tools.ts";
import type { Correction, Memory, Reminder, Song } from "./types.ts";

/** Most model rounds one reply may take (each round of tool calls costs one). */
const MAX_ROUNDS = 24;

const OS_NAMES: Record<string, string> = { darwin: "Mac", win32: "Windows", linux: "Linux" };

type Block = Anthropic.Beta.BetaContentBlock;

/** Request fields shared by every call: model, effort, and refusal fallback where the model supports it. */
function base(config: Config) {
  const fallback = useFallbacks(config.model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
  return { model: config.model, output_config: { effort: config.effort }, ...fallback };
}

/**
 * The part of an assistant turn that may be sent back. After a mid-reply
 * fallback, blocks before the last `fallback` marker belong to the model
 * that declined: only its text is kept; its thinking and tool calls are
 * dropped (and those tool calls are never run).
 */
export function echoable(content: Block[]): Block[] {
  const boundary = content.findLastIndex((b) => b.type === "fallback");
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === "text");
}

export interface TurnHandlers {
  text(delta: string): void;
  memory(memory: Memory): void;
  song(song: Song): void;
  correction(correction: Correction): void;
  activity(activity: Activity): void;
  reminderSet(reminder: Reminder): void;
  /** Asks the person to approve an action; resolves false if they decline or don't answer. */
  approve(request: ApprovalRequest): Promise<boolean>;
}

export interface TurnResult {
  text: string;
  song?: Song;
  /** done: finished normally. aborted: the listener interrupted. refused: declined by every model; drop the text. */
  end: "done" | "aborted" | "refused" | "truncated";
}

/**
 * One reply from the companion, streamed. Runs the tool loop (remember,
 * compose) until Claude stops asking for tools. The user's message must
 * already be in the transcript; `nudge` adds an unsaved instruction turn.
 */
export async function runTurn(opts: {
  client: Anthropic;
  config: Config;
  store: Store;
  nudge?: string;
  signal: AbortSignal;
  on: TurnHandlers;
}): Promise<TurnResult> {
  const { client, config, store, signal, on } = opts;
  const state = await store.load();
  const practice = config.mode === "practice";
  const computer = !practice && config.computer;
  const web = !practice && config.web;
  const persona = practice
    ? practicePrompt(state.profile!, config.practice)
    : personaPrompt(state.profile!, {
        computer: computer ? { os: OS_NAMES[process.platform] ?? os.type(), root: displayPath(config.workspace) } : undefined,
        web,
      });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: persona, cache_control: { type: "ephemeral" } },
    { type: "text", text: contextPrompt(state, new Date()) },
  ];
  const tools = toolsFor(config.mode, { computer, web, model: config.model });
  const agentDeps = {
    computer: { root: config.workspace, platform: process.platform, approve: on.approve, signal },
    store,
    activity: on.activity,
    reminderSet: on.reminderSet,
  };
  const messages = historyMessages(state);
  if (opts.nudge) messages.push({ role: "user", content: opts.nudge });

  let text = "";
  let song: Song | undefined;
  let jsonRetries = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let roundText = "";
    const stream = client.beta.messages.stream(
      { ...base(config), max_tokens: 16000, system, messages, tools },
      { signal },
    );
    stream.on("text", (delta, snapshot) => {
      // A new text block (after a tool call, or in a new round): keep it apart from the last one.
      if (delta === snapshot && text && !text.endsWith("\n")) {
        text += "\n\n";
        on.text("\n\n");
      }
      roundText += delta;
      text += delta;
      on.text(delta);
    });
    stream.on("contentBlock", (block) => {
      if (block.type !== "server_tool_use") return;
      const input = (block.input ?? {}) as { query?: unknown; url?: unknown };
      if (block.name === "web_search") on.activity({ kind: "search", target: String(input.query ?? "") });
      if (block.name === "web_fetch") on.activity({ kind: "fetch", target: String(input.url ?? "") });
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError || signal.aborted) return { text, song, end: "aborted" };
      if (err instanceof Anthropic.APIError) throw err;
      // A streamed tool input that isn't parseable JSON. Re-issue the round
      // only if nothing was said yet, so the listener never hears it twice.
      if (roundText || jsonRetries++ >= 2) throw err;
      round--;
      continue;
    }

    if (message.stop_reason === "refusal") return { text: "", end: "refused" };
    const content = echoable(message.content);
    // A long web search pauses the turn; send it back as is and the model carries on.
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content });
      continue;
    }
    const calls = content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (message.stop_reason !== "tool_use" || calls.length === 0) {
      return { text, song, end: message.stop_reason === "max_tokens" ? "truncated" : "done" };
    }

    messages.push({ role: "assistant", content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const outcome = COMPUTER_TOOL_NAMES.has(call.name)
        ? await runComputerTool(call.name, call.input, agentDeps)
        : runTool(call.name, call.input);
      if (outcome.fact) {
        let saved: Memory | null = null;
        await store.update((s) => {
          saved = addMemory(s, outcome.fact!);
        });
        if (saved) on.memory(saved);
        else Object.assign(outcome, { result: "Already in your notes.", isError: true });
      }
      if (outcome.song) {
        song = outcome.song;
        on.song(song);
      }
      if (outcome.correction) {
        let shown: Correction | null = null;
        await store.update((s) => {
          shown = addCorrection(s, outcome.correction!);
        });
        if (shown) on.correction(shown);
        else Object.assign(outcome, { result: "Already shown for this message.", isError: true });
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.result, is_error: outcome.isError });
    }
    messages.push({ role: "user", content: results });
  }
  return { text, song, end: "done" };
}

/** Thrown when the companion couldn't be named (refusal or unreadable reply). */
export class SetupError extends Error {}

/** First boot: the companion picks its name and writes its greeting. */
export async function nameCompanion(
  client: Anthropic,
  config: Config,
  answers: SetupAnswers,
): Promise<{ name: string; greeting: string }> {
  // Streamed (then collected) so failures surface as the same SDK error classes as chat turns.
  const message = await client.beta.messages
    .stream({
      ...base(config),
      max_tokens: 16000,
      output_config: { effort: config.effort, format: { type: "json_schema", schema: NAMING_SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            config.mode === "practice"
              ? practiceNamingPrompt(answers, config.practice, new Date())
              : namingPrompt(answers, new Date()),
        },
      ],
    })
    .finalMessage();
  if (message.stop_reason === "refusal") throw new SetupError("declined");
  const block = message.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  let parsed: { name?: unknown; greeting?: unknown };
  try {
    parsed = JSON.parse(block?.text ?? "");
  } catch {
    throw new SetupError("unreadable reply");
  }
  const name = cleanName(parsed.name) || "Juniper";
  const greeting =
    typeof parsed.greeting === "string" && parsed.greeting.trim()
      ? parsed.greeting.trim()
      : `Hi, ${answers.userName}. I'm ${name}. I'm really glad you're here.`;
  return { name, greeting };
}
