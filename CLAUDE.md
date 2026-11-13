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
npm run get-voice          # download the open-source models (Kokoro, Silero VAD, Parakeet) into data/voices
```

Needs Node ≥ 22.18. Node runs the `.ts` files directly by stripping types, which has consequences:
- Only erasable TypeScript is allowed (`erasableSyntaxOnly` is on): no `enum`, `namespace`, or constructor parameter properties.
- Relative imports must include the extension (`./store.ts`, `../public/js/lib/notes.js`). Type-only imports must use `import type` (`verbatimModuleSyntax`).
- `tsc` only type-checks (`noEmit`); nothing is ever compiled.

## Architecture

**One turn, end to end.** A listener turns speech into whole utterances, and `app.js` POSTs each one to `/api/chat`. There are two listeners:
- `Ears` (`public/js/ears.js`), when the server has local hearing. It streams the mic to the server, which transcribes it.
- `Listener` (`public/js/listener.js`), the browser's Web Speech API, otherwise. The server saves the user message, then `runTurn()` (`server/chat.ts`) streams from Claude and runs the tool loop. Text deltas, saved memories and composed songs go back to the page as NDJSON lines; the `ChatEvent` union in `server/types.ts` is the wire contract. As text arrives, `Speaker` (`public/js/speaker.js`) speaks each finished sentence (`SentenceFeed` in `public/js/lib/sentences.js`). When it is done, the page plays any song and starts listening again.

**Her turn and yours.** `refresh()` in `app.js` calls `listener.pause()` whenever speech or music is playing, and `resume()` when it stops.
- `Listener` really stops: browser recognition has no echo cancellation for the page's own audio, so it would transcribe her voice.
- `Ears` treats pause/resume as "her turn" and "your turn". With `prefs.bargeIn`, it keeps streaming through her turn so the person can talk over her. Otherwise it goes quiet like `Listener`.

Interrupting goes through `interrupt()`: tapping the figure, pressing Esc, the stop button, starting a new message, or a server `barge` event. It aborts the fetch, and the server sees the closed response and aborts the Claude stream. If the voice was speaking, `interrupt()` also cuts the reply to what was heard:
- `speaker.heardChars()` measures it.
- `cutToHeard()` in `lib/sentences.js` cuts the text.
- `POST /api/heard` saves the cut, keyed by the reply's `at` from the `turn` event. A report that arrives before the aborted reply is saved waits in `heardCuts`.

The persona knows that a reply ending in "…" was cut off there.

**Persistence.** `Store` (`server/store.ts`) holds the whole `State` (profile, memories, transcript) in memory. It writes the file atomically and one write at a time. All mutations must go through `store.update()`. The server is the source of truth. The page keeps a copy for rendering and stores only per-device voice settings in `localStorage` (`lei.prefs`). On an abort the server still saves the partial reply; on a refusal or error it saves nothing.

**Two modes, one codebase.** `LEI_MODE` (`config.mode`) picks `companion` (the Her-style friend) or `practice` (an English speaking partner for Portuguese/Spanish speakers). The mode changes:
- the persona (`personaPrompt` vs `practicePrompt`) and the naming prompt;
- the tools (`toolsFor()`: companion gets `compose` and the computer tools, practice gets `correct`);
- the setup questions (`steps()` in `app.js`).

Practice mode also sends `ui` (the learner's language, for `i18n.js`) and `speechLang` (the target language, for `Listener` and `Speaker`) in `/api/state`. Corrections are stored in `State.corrections`, tied to the user message they belong to by `forAt`. Text the tutor writes in the learner's own language goes in `[square brackets]`: `speakable()` drops it from speech, and `splitAsides()` renders it as a quieter line.

**Interface text.** All user-facing strings live in `public/js/i18n.js` (`en`, `pt`, `es`; missing keys fall back to English). Use `t("key", vars)` in `app.js` and `data-i18n` attributes in `index.html`; don't hard-code copy. The Portuguese and Spanish practice strings assume English is the target language.

**Computer abilities: looking is free, changing waits for approval.** In companion mode (`config.computer`, `config.web`), `toolsFor()` adds:
- the computer tools in `server/tools.ts`, run by `runComputerTool()` on top of `server/computer.ts`:
  - no approval needed: `system_status`, `list_directory`, `find_files`, `read_file`, `set_reminder`, `cancel_reminder`, and `open` for http(s) URLs and folders;
  - approval needed every time: `write_file`, `run_command`, and `open` for files and apps (opening a file can run it);
  - approval needed once outside text has entered the turn: `open` for web links. `ComputerContext.untrusted` is set by file tools, commands and the hosted web tools, because that text could ask her to send data out in a URL;
- Anthropic's hosted `web_search`/`web_fetch`. A long search can end a round with `pause_turn`, which `runTurn()` sends back and continues.

**How an approval works.** A tool calls `ctx.approve({ tool, title, detail, danger })`, which is `on.approve` from `runTurn()`. In `server/index.ts`, `requestApproval()` sends an `approval` event, then waits for `POST /api/approve` with the same id. It resolves false after 120 s or when the chat request aborts, and sends `approval_result` either way. The page shows a card (`showApproval()` in `app.js`) and also takes a spoken yes/no in `onUtterance()`. A declined action returns a normal tool result saying so, and the model carries on.

Rules for these tools:
- Every path goes through `resolveInRoot()`, which confines it to `config.workspace` and refuses secret files (`isSecretPath()`), even with approval.
- Every action that changes something must go through `ctx.approve()` first, with `detail` showing exactly what will run or be written. `danger` (from `isRiskyCommand()`, or replacing an existing file) only changes how the card looks; it never skips the question.
- `run_command` refuses `sudo` outright. It runs in the user's shell with stdin closed, a 60 s timeout, and `childEnv()`, which strips Lei's API keys and anything named like a key, token, secret or password. Aborting the turn kills the child.
- There is no approval bypass and no "always allow". Adding one, or a tool that acts outside the workspace, is a product and security decision for the owner; don't add one as a side change.
- Tools report progress through `on.activity`, which becomes `activity` events that the page shows as a line under the reply.

**Voice out.** `createVoice()` (`server/tts.ts`) picks one engine at startup (`LEI_VOICE`, or the first that's set up: ElevenLabs, a local OpenAI-style speech server, Kokoro). `POST /api/tts` turns one sentence into audio; `/api/state` lists the engine's voices, and the page offers them as `server:<id>` next to the browser voices. If a clip fails, `Speaker` says that sentence with the browser voice.

**Kokoro** (`server/kokoro.ts`) is the open-source voice. It runs in-process through `onnxruntime-node`, with model files downloaded by `npm run get-voice` (`scripts/get-voice.ts`) and checked against the SHA-256 hashes in `KOKORO_FILES`.
- **Phonemes:** English goes through the `phonemizer` package, with kokoro-js's normalisation and fixes. Spanish and Portuguese go through the `espeak-ng` program with misaki's symbol mapping; those voices are offered only when it's installed.
- **Queue:** requests run one at a time, so the first sentence isn't slowed by prefetches.
- **Silence:** clips are trimmed so sentences don't drag.
- **Packages:** `onnxruntime-node` and `phonemizer` are optional dependencies, imported only when Kokoro loads. `phonemizer`'s Emscripten glue adds process-wide crash handlers, and `loadEnglishPhonemizer()` removes them; keep that.
- **Tests:** the voice test that runs the real model is skipped unless the files are in `LEI_VOICE_DIR`.

**Local hearing** (`server/hearing.ts`, `server/listening.ts`). Silero VAD and Parakeet TDT 0.6B v3 run in-process through `sherpa-onnx-node`, an optional dependency loaded with `createRequire`. Smart Turn v3.2 (`server/smartturn.ts`) runs through `onnxruntime-node`:
- `whisperFeatures()` reproduces Pipecat's Whisper log-mel features; its own mixed-radix `Fft` handles the 400 points.
- Its probability feeds `endOfTurnWait()`.
- It's optional: off with `LEI_SMART_TURN=off`, or when the file is missing. `createHearing()` returns null when the models aren't downloaded or `LEI_HEARING=browser`, and the page then uses `Listener`.
- **Transport:** the page's AudioWorklet (`public/js/mic-worklet.js`) sends 16 kHz 16-bit frames over a WebSocket at `/api/listen`. Each connection gets one `ListenSession`.
- **Clock:** `ListenSession` counts time in samples, not wall-clock, so tests can feed audio deterministically.
- **Turn-taking:**
  - It decodes the utterance every 0.6 s for partial text (every 0.35 s while she talks), and again when a pause starts.
  - It ends the turn after `endOfTurnWait()` from `public/js/lib/turns.js`: short after "." or "?", long after "and…" or "um", based on the person's own pauses (`PauseStats`).
  - Smart Turn's verdict on the pause shortens the wait when it's confident, and lengthens it a little when it's very sure the person isn't done. On Kokoro's synthetic speech it's sometimes wrong, so it mostly speeds things up.
- **While she speaks:**
  - It sends `duck` when speech starts and `barge` once `wantsTheFloor()`.
  - It drops listening noises (`isBackchannel()`).
  - It drops her own echo (`isEcho()` against the sentences the page reports through `herSentence()`), but only for utterances that began while she was talking.
- The page shows partials in `#heard` and sends finals like typed messages.

**Speaker extras** (`public/js/speaker.js`).
- `duck()` lowers the clip volume.
- `onSentence` reports each sentence as it starts, so the server can tell her echo from the person.
- Speed goes to the voice engine (`speed` in `/api/tts`), never `playbackRate`.
- `SentenceFeed` starts a long first sentence at its last comma.
- `filler()` plays a cached "Hmm." if no reply text arrives within `FILLER_MS` of a message.

`?debug` shows per-turn timings under each reply, and the server logs `[turn] first words after N ms`.

**Reminders** live in `State.reminders`. `ReminderClock` (`server/reminders.ts`) fires due ones every 10 s. It delivers them to open pages over server-sent events (`GET /api/events`), and keeps undelivered ones until a page connects.

**Remote access (phones, other computers).** With `LEI_REMOTE_PORT` and `LEI_REMOTE_HOSTS` set, a second server listens on `127.0.0.1:<remote port>` for `tailscale serve` to forward to. `route(req, res, remote)` treats the two ports differently:
- **Local port:** trusted; it's the person at the Mac.
- **Remote port:** `refuseRemote()` requires an allowlisted Host, refuses `Tailscale-Funnel-Request`, and checks Origin and content type. Every request also needs a paired device (`findDevice()` from the `lei_device` cookie). Before pairing, only the files in `PAIRING_FILES` and `POST /api/pair` are served; other pages redirect to `/pair.html` and the API answers 401.
- **Pairing:** codes come only from the local page (`POST /api/devices/code`, `Pairing` in `server/devices.ts`). A code is single-use, lasts five minutes and allows five tries; failures are also rate-limited across all codes.
- **Devices:** `State.devices` stores only token hashes, and `Store.reset()` keeps devices.
- **The WebSocket** on the remote port checks the same things in `upgrade(true)`.
- **Audit:** approvals and device changes are appended to `audit.log` next to the state file (`server/audit.ts`), with `by` naming the device.
- **Never** make the remote port listen on anything but loopback, skip the device check on any remote route, or accept a spoken "yes" for `danger` approvals (`onUtterance()` in `app.js`).

**Request checks.** `server/security.ts` guards every `/api/` route:
- While the server listens on localhost, the Host header must be localhost. This blocks DNS rebinding.
- Writes need a same-origin `Origin` (or none), no `Sec-Fetch-Site: cross-site`, and a JSON content type.

New write routes get these checks automatically; keep them. The mic WebSocket is checked by `refuseUpgrade()`, which *requires* a same-origin `Origin`. Any website can open a WebSocket to localhost, so that check must stay.

**Code shared by browser and server.** `public/js/lib/*.js` is plain ESM with no DOM access. The browser loads it directly and the server and tests import it. `notes.js` is the music score format (`NOTE:BEATS`, `+` for chords, `R` for rests): the server uses it to validate `compose` tool input, and `music.js` uses it to play songs. `turns.js` holds the turn-taking rules, used by `server/listening.ts` and by the browser `Listener`. `sentences.js` holds `cutToHeard()`, used by the page and by `POST /api/heard`. Keep these files DOM-free.

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

The tests use `node:test` and need no network. `test/computer.test.ts` builds a temporary folder tree, including fake secret files, to check path confinement. `test/chat.test.ts` drives `runTurn()` with a fake client that replays scripted model rounds through `beta.messages.stream()`. Extend that pattern rather than calling the real API. `test/listening.test.ts` drives `ListenSession` with a fake VAD and a fake recognizer, in 20 ms frames; extend it for turn-taking changes. `test/hearing.test.ts` and the real-model test in `test/voice.test.ts` run only where the models are downloaded. The browser code under `public/js/` (other than `lib/`) has no unit tests. Check it by running the server and using the page, or with the Playwright scripts in `scripts/e2e/`:
- `talk.cjs` feeds a WAV file in as the mic, against a fake Claude endpoint.
- `pair.cjs` walks a phone through pairing.

**Where work stands:** `docs/HANDOFF.md` lists what's verified and what's next, and `docs/business-plan.md` explains why practice mode for Mexico is the product.
