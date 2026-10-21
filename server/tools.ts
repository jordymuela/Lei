import type Anthropic from "@anthropic-ai/sdk";
import { normalizeSong, songSeconds } from "../public/js/lib/notes.js";
import {
  type Activity,
  type ComputerContext,
  findFiles,
  listDirectory,
  openTarget,
  readTextFile,
  runCommand,
  systemStatus,
  writeTextFile,
} from "./computer.ts";
import type { Mode } from "./config.ts";
import { parseDue } from "./reminders.ts";
import { type Store, addReminder } from "./store.ts";
import type { Reminder, Song } from "./types.ts";

// Inputs stream in as they're written (eager_input_streaming), so the API no
// longer validates them against the schema; runTool checks every field itself.

const REMEMBER: Anthropic.Beta.BetaTool = {
  name: "remember",
  description:
    'Save one short, lasting fact about the person (third person, under 25 words) so you remember it in future conversations. Returns "saved".',
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      fact: { type: "string", description: 'For example: "Their sister Ana just moved to Lisbon."' },
    },
    required: ["fact"],
  },
};

const COMPOSE: Anthropic.Beta.BetaTool = {
  name: "compose",
  description:
    "Compose a short piano piece that captures this moment. The app plays it right after you finish talking. Returns its length in seconds.",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "A short, evocative title." },
      tempo: { type: "number", description: "Beats per minute, 50 to 140." },
      melody: {
        type: "string",
        description:
          '8 to 40 space-separated NOTE:BEATS tokens. NOTE is a pitch from C3 to C6 such as C4, F#4 or Bb3, several pitches joined with + for a chord (C4+E4+G4), or R for a rest. Example: "E4:1 G4:0.5 A4:0.5 B4:1.5 R:0.5 A4+C5:2"',
      },
      harmony: {
        type: "string",
        description: "Optional softer accompaniment in the same format, usually low chords or bass notes that last as long as the melody.",
      },
    },
    required: ["title", "melody"],
  },
};

const CORRECT: Anthropic.Beta.BetaTool = {
  name: "correct",
  description:
    "Show the learner one correction for their last message: what they said, a better way to say it, and a very short explanation in their own language. The app shows it as a card under their message and saves it for review. Returns \"shown\".",
  eager_input_streaming: true,
  input_schema: {
    type: "object",
    properties: {
      said: { type: "string", description: "The words they used, quoted from their message." },
      better: { type: "string", description: "A natural, correct way to say it in the language they're practising." },
      why: { type: "string", description: "One short sentence in the learner's own language explaining the change." },
    },
    required: ["said", "better", "why"],
  },
};

// The computer tools. Looking runs straight away; anything that changes the
// machine waits for the person's OK (see computer.ts).
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.BetaTool => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: { type: "object", properties, required },
});

const COMPUTER: Anthropic.Beta.BetaTool[] = [
  tool("system_status", "Check this computer: operating system, uptime, memory, free disk space and load. Returns JSON.", {}),
  tool(
    "list_directory",
    "List a folder's contents with sizes and modification times. Paths can be absolute, relative to the allowed root, or start with ~.",
    { path: { type: "string", description: "Folder to list, e.g. ~/Downloads" } },
    ["path"],
  ),
  tool(
    "find_files",
    "Find files and folders whose name contains some text, searching subfolders (hidden folders and node_modules are skipped). Returns up to 50 paths.",
    {
      query: { type: "string", description: "Part of the name, e.g. invoice or .pdf" },
      path: { type: "string", description: "Folder to start from; defaults to the allowed root" },
    },
    ["query"],
  ),
  tool(
    "read_file",
    "Read a text file (up to 20,000 characters). Files that hold keys or passwords are refused.",
    {
      path: { type: "string" },
      max_chars: { type: "number", description: "Read at most this many characters" },
    },
    ["path"],
  ),
  tool(
    "open",
    "Open a web page (https://...) or a folder right away, or a file or an app by name (e.g. Spotify, Notes) after the person approves.",
    { target: { type: "string", description: "A URL, a folder or file path, or an app name" } },
    ["target"],
  ),
  tool(
    "write_file",
    "Create a text file, replace one, or add to the end of one. The person sees the path and the content and must approve first.",
    {
      path: { type: "string" },
      content: { type: "string" },
      append: { type: "boolean", description: "Add to the end instead of replacing the file" },
    },
    ["path", "content"],
  ),
  tool(
    "run_command",
    "Run one shell command on this computer (zsh on a Mac) and get its exit code and output, e.g. osascript to control apps, or a script. The person sees the exact command and must approve first. No sudo. Stops after 60 seconds; there is no input, so avoid interactive commands.",
    {
      command: { type: "string" },
      cwd: { type: "string", description: "Folder to run it in; defaults to the allowed root" },
    },
    ["command"],
  ),
  tool(
    "set_reminder",
    "Set a reminder that the app will say out loud when it's due. Give either in_minutes or at.",
    {
      text: { type: "string", description: "What to remind them of, in a few words" },
      in_minutes: { type: "number", description: "Minutes from now" },
      at: { type: "string", description: "Local date-time, e.g. 2026-10-21T08:30" },
    },
    ["text"],
  ),
  tool("cancel_reminder", "Cancel a pending reminder by its id (listed in your context).", { id: { type: "string" } }, ["id"]),
];

export const COMPUTER_TOOL_NAMES = new Set(COMPUTER.map((t) => t.name));

/** Anthropic-hosted web search and fetch; the newer versions aren't available on Haiku. */
export function webTools(model: string): Anthropic.Beta.BetaToolUnion[] {
  return /haiku/.test(model)
    ? [
        { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        { type: "web_fetch_20250910", name: "web_fetch", max_uses: 5 },
      ]
    : [
        { type: "web_search_20260209", name: "web_search", max_uses: 5 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
      ];
}

/** The tools Claude gets in each mode. Computer and web tools are companion-mode only. */
export function toolsFor(mode: Mode, opts: { computer?: boolean; web?: boolean; model?: string } = {}): Anthropic.Beta.BetaToolUnion[] {
  if (mode === "practice") return [REMEMBER, CORRECT];
  return [REMEMBER, COMPOSE, ...(opts.computer ? COMPUTER : []), ...(opts.web ? webTools(opts.model ?? "") : [])];
}

/** What running a tool produced: the result Claude reads, plus any effect for the app to apply. */
export interface ToolOutcome {
  result: string;
  isError: boolean;
  fact?: string;
  song?: Song;
  correction?: { said: string; better: string; why: string };
}

const fail = (result: string): ToolOutcome => ({ result, isError: true });
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Validates and runs one tool call. Saving memories and corrections is left
 * to the caller (chat.ts), which owns the store; a duplicate comes back as an
 * error result there.
 */
export function runTool(name: string, input: unknown): ToolOutcome {
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!args) return fail("Error: input must be an object.");
  switch (name) {
    case "remember": {
      if (!text(args.fact)) return fail('Error: "fact" must be a non-empty string.');
      return { result: "saved", isError: false, fact: text(args.fact) };
    }
    case "compose": {
      const song = normalizeSong(args);
      if (!song) return fail('Error: couldn\'t read the notes. Use NOTE:BEATS tokens like "E4:1 G4:0.5 R:0.5 C5+E5:2".');
      return { result: JSON.stringify({ ok: true, seconds: Math.round(songSeconds(song)) }), isError: false, song };
    }
    case "correct": {
      const said = text(args.said), better = text(args.better), why = text(args.why);
      if (!said || !better) return fail('Error: "said" and "better" must be non-empty strings.');
      if (said === better) return fail('Error: "better" is the same as "said"; nothing to correct.');
      return { result: "shown", isError: false, correction: { said, better, why } };
    }
    default:
      return fail(`Error: unknown tool "${name}".`);
  }
}

/** What a computer tool needs: the machine, the store (for reminders), and a way to report progress. */
export interface AgentDeps {
  computer: ComputerContext;
  store: Store;
  activity(a: Activity): void;
  reminderSet(r: Reminder): void;
}

/** Runs one computer tool. Failures come back as error results Claude can read, never as exceptions. */
export async function runComputerTool(name: string, input: unknown, deps: AgentDeps): Promise<ToolOutcome> {
  const a = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const root = deps.computer.root;
  try {
    switch (name) {
      case "system_status":
        deps.activity({ kind: "status", target: "" });
        return { result: await systemStatus(root), isError: false };
      case "list_directory":
        deps.activity({ kind: "list", target: text(a.path) || "~" });
        return { result: await listDirectory(root, text(a.path)), isError: false };
      case "find_files":
        deps.activity({ kind: "find", target: text(a.query) });
        return { result: await findFiles(root, text(a.query), text(a.path) || "."), isError: false };
      case "read_file":
        if (!text(a.path)) return fail('Error: "path" is required.');
        deps.activity({ kind: "read", target: text(a.path) });
        return { result: await readTextFile(root, text(a.path), Number(a.max_chars) || undefined), isError: false };
      case "open":
        deps.activity({ kind: "open", target: text(a.target) });
        return { result: await openTarget(deps.computer, text(a.target)), isError: false };
      case "write_file":
        if (!text(a.path) || typeof a.content !== "string") return fail('Error: "path" and "content" are required.');
        deps.activity({ kind: "write", target: text(a.path) });
        return { result: await writeTextFile(deps.computer, text(a.path), a.content, a.append === true), isError: false };
      case "run_command":
        if (!text(a.command)) return fail('Error: "command" is required.');
        deps.activity({ kind: "run", target: text(a.command) });
        return { result: await runCommand(deps.computer, text(a.command), text(a.cwd) || undefined), isError: false };
      case "set_reminder": {
        if (!text(a.text)) return fail('Error: "text" is required.');
        const due = parseDue({ in_minutes: a.in_minutes, at: a.at });
        if (typeof due === "string") return fail("Error: " + due);
        let reminder: Reminder | null = null;
        await deps.store.update((s) => {
          reminder = addReminder(s, text(a.text), due);
        });
        deps.activity({ kind: "reminder", target: text(a.text) });
        deps.reminderSet(reminder!);
        return { result: `Set reminder ${reminder!.id} for ${new Date(due).toLocaleString()}.`, isError: false };
      }
      case "cancel_reminder": {
        let found = false;
        await deps.store.update((s) => {
          const before = s.reminders.length;
          s.reminders = s.reminders.filter((r) => r.id !== text(a.id) || r.firedAt);
          found = s.reminders.length < before;
        });
        return found ? { result: "Cancelled.", isError: false } : fail("Error: no pending reminder with that id.");
      }
      default:
        return fail(`Error: unknown tool "${name}".`);
    }
  } catch (err) {
    return fail("Error: " + (err instanceof Error ? err.message : String(err)));
  }
}
