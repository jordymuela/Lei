# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Lei is a single-user, voice-first companion app inspired by the film *Her*. A small Node server (`server/`) talks to the Claude API and keeps state in one JSON file. A static browser page (`public/`) handles speech in both directions. There is no framework, bundler or build step.

## Commands

```bash
npm start                  # run the server (reads .env if present), http://127.0.0.1:3000
npm run dev                # same, restarting on file changes
npm test                   # all tests: node --test "test/**/*.test.ts"
node --test test/chat.test.ts                      # one file
node --test --test-name-pattern="refusal" test/    # tests whose name matches
npm run typecheck          # tsc --noEmit (server, tests, public/js/lib)
npm run check              # typecheck + tests
```

Needs Node ≥ 22.18. Node runs the `.ts` files directly by stripping types, which has consequences:
- Only erasable TypeScript is allowed (`erasableSyntaxOnly` is on): no `enum`, `namespace`, or constructor parameter properties.
- Relative imports must include the extension (`./store.ts`, `../public/js/lib/notes.js`). Type-only imports must use `import type` (`verbatimModuleSyntax`).
- `tsc` only type-checks (`noEmit`); nothing is ever compiled.

## Architecture

**One turn, end to end.** The browser `Listener` (`public/js/listener.js`, Web Speech API) turns continuous recognition into whole utterances after a pause. `app.js` POSTs it to `/api/chat`. The server saves the user message, then `runTurn()` (`server/chat.ts`) streams from Claude and runs the tool loop. Text deltas, saved memories and composed songs go back to the page as NDJSON lines; the `ChatEvent` union in `server/types.ts` is the wire contract. As text arrives, `Speaker` (`public/js/speaker.js`) speaks each finished sentence (`SentenceFeed` in `public/js/lib/sentences.js`). When it is done, the page plays any song and starts listening again.

**Half-duplex voice is deliberate.** `refresh()` in `app.js` pauses the listener whenever speech or music is playing, then resumes it 350 ms after. Browser speech recognition has no echo cancellation for the page's own audio, so listening while she speaks would transcribe her own voice. Interrupting goes through `interrupt()`: tapping the figure, pressing Esc, the stop button, or starting a new message. It aborts the fetch, and the server sees the closed response and aborts the Claude stream.

**Persistence.** `Store` (`server/store.ts`) holds the whole `State` (profile, memories, transcript) in memory. It writes the file atomically and one write at a time. All mutations must go through `store.update()`. The server is the source of truth. The page keeps a copy for rendering and stores only per-device voice settings in `localStorage` (`lei.prefs`). On an abort the server still saves the partial reply; on a refusal or error it saves nothing.

**Two modes, one codebase.** `LEI_MODE` (`config.mode`) picks `companion` (the Her-style friend) or `practice` (an English speaking partner for Portuguese/Spanish speakers). The mode changes:
- the persona (`personaPrompt` vs `practicePrompt`) and the naming prompt;
- the tools (`toolsFor()`: companion gets `compose`, practice gets `correct`);
- the setup questions (`steps()` in `app.js`).

Practice mode also sends `ui` (the learner's language, for `i18n.js`) and `speechLang` (the target language, for `Listener` and `Speaker`) in `/api/state`. Corrections are stored in `State.corrections`, tied to the user message they belong to by `forAt`. Text the tutor writes in the learner's own language goes in `[square brackets]`: `speakable()` drops it from speech, and `splitAsides()` renders it as a quieter line.

**Interface text.** All user-facing strings live in `public/js/i18n.js` (`en`, `pt`, `es`; missing keys fall back to English). Use `t("key", vars)` in `app.js` and `data-i18n` attributes in `index.html`; don't hard-code copy. The Portuguese and Spanish practice strings assume English is the target language.

**Code shared by browser and server.** `public/js/lib/*.js` is plain ESM with no DOM access. The browser loads it directly and the server and tests import it. `notes.js` is the music score format (`NOTE:BEATS`, `+` for chords, `R` for rests): the server uses it to validate `compose` tool input, and `music.js` uses it to play songs. Keep these files DOM-free.

**Prompt layout** (`server/prompt.ts`):
- `system[0]` is `personaPrompt(profile)`. It is stable per profile and marked `cache_control`.
- `system[1]` is `contextPrompt()`: the clock, the gap since the last message, and memories. It changes every turn, so it goes after the cache breakpoint.
- History is the last `HISTORY_TURNS` transcript messages, replayed as plain text. Thinking blocks and tool calls from earlier turns are not stored or replayed.
- `historyMessages()` prepends a synthetic user turn because the transcript starts with the companion's greeting.

## Claude API conventions

- Calls go through `client.beta.messages` with `fallbacks: "default"` and the `server-side-fallback-2026-07-01` beta. This is skipped for Haiku models (`useFallbacks()` in `config.ts`). A server-side fallback can happen mid-reply. `echoable()` in `chat.ts` keeps only text from before the last `fallback` block when echoing an assistant turn back, so tool calls from the model that declined are never run.
- The defaults are model `claude-opus-5-5` and `output_config.effort: "low"`, chosen for voice latency. This model always thinks and rejects `thinking: {type: "disabled"}`, so lower effort is the only way to shorten replies. Don't add a disabled-thinking setting.
- Tools (`server/tools.ts`) set `eager_input_streaming: true`, so the API doesn't validate their input. `runTool()` checks every field itself. Keep that validation when adding a tool, and keep the `stop_reason` checks in `runTurn()`: refusal drops the text, and tools cut off by `max_tokens` are never run.
- Forced `tool_choice` is a 400 on this model. Steer tool use from the persona prompt.
- First boot (`nameCompanion`) uses structured output (`output_config.format` with `NAMING_SCHEMA`). It is streamed and collected with `finalMessage()`, so that errors arrive as the same SDK classes as in chat turns.
- `errorCode()` in `server/index.ts` maps SDK error classes to the short codes that `explain()` in `app.js` turns into user-facing text. Add a case to both when adding a new failure mode.

## Tests

The tests use `node:test` and need no network. `test/chat.test.ts` drives `runTurn()` with a fake client that replays scripted model rounds through `beta.messages.stream()`. Extend that pattern rather than calling the real API. The browser code under `public/js/` (other than `lib/`) has no automated tests. Check it by running the server and using the page.
