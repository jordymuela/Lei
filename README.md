# Lei

A voice-first AI companion inspired by the film *Her*, built on Claude. You talk out loud; it answers out loud. On first run it asks you four questions, picks its own name, and greets you. After that it remembers what matters to you, picks up where you left off when you come back, and now and then composes a little piano piece.

## Requirements

- Node.js 22.18 or newer. The server is TypeScript that Node runs directly, so there is no build step.
- A Claude API key, or an `ant auth login` profile on this machine.
- For talking out loud: any modern browser once the models are downloaded (see below); otherwise Chrome, Edge or Safari, whose built-in speech recognition Lei uses. You can always type, and replies are still spoken.

## Run it

```bash
npm install
cp .env.example .env    # then put your ANTHROPIC_API_KEY in .env
npm start               # http://127.0.0.1:3000
```

Open the page, go through setup, then tap the mic and talk. Lei listens until you pause, answers, and starts listening again once it has finished speaking. To cut it off, tap the figure or press Esc.

## Her voice and ears, on your computer

Out of the box, Lei uses your browser's voices and speech recognition. For a conversation that feels like talking to a person, download the open-source models once:

```bash
npm run get-voice       # about 850 MB, once; every file checked against a pinned SHA-256 hash
npm start
```

That gets two things, both running inside Lei's server on your computer's CPU, with no GPU, no Python and no account:

- **A human-sounding voice: Kokoro.** Pick one under **Settings**. Heart is the default; Bella, Emma, Nicole and Michael are also good.
- **Ears: Parakeet speech recognition, with Silero voice detection.** What you say never leaves the computer, and she hears you better:
  - **She answers as soon as you're done.** About a third of a second after a finished sentence or question; the browser's recognizer took one to two seconds. A small model, Smart Turn, judges from your voice whether you've finished. If you trail off with "and…" or "um", she waits, and she learns how long you usually pause.
  - **You can talk over her.** Her voice dips the moment you start. "Wait", "stop" or a couple of real words stop her, and what you said becomes your next message. A "mm-hm" or "yeah" lets her carry on. Headphones make this work best. Without them, she filters out her own voice coming back through the speakers. Turn it off under **Settings → Let me talk over Lei**.
  - **She remembers only what you heard.** If you cut her off, her reply is saved up to where she stopped, marked with "…".
  - **No dead air.** If a reply is slow to start, she says a soft "Hmm." first.

Other notes:
- Voice input now works in any browser that can record audio, Firefox included.
- Add `?debug` to the page's address to see how long each part of a turn took.
- **Spanish and Portuguese voices** need one more program: `brew install espeak-ng` on a Mac. Without it, only the English voices are offered. The speech recognition handles 25 European languages on its own.
- **Other voices:**
  - Any local speech server with OpenAI's `/v1/audio/speech` endpoint works: Kokoro-FastAPI, Chatterbox-TTS-Server, Orpheus-FastAPI, mlx-audio or LocalAI. Set `LEI_TTS_URL` (and `LEI_TTS_VOICE`).
  - ElevenLabs works with `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.
- If the server voice fails for a sentence, the browser voice says it instead.

**Licenses.**
- Kokoro's model is Apache-2.0 (by hexgrad); its files come from the kokoro-onnx project's release.
- Parakeet TDT 0.6B v3 is NVIDIA's, under CC-BY-4.0: commercial use is allowed with attribution.
- Smart Turn v3.2 is Pipecat's, under BSD-2-Clause; `get-voice` takes it from Pipecat's PyPI package and checks both hashes.
- Silero VAD is MIT. sherpa-onnx, which runs them, is Apache-2.0.
- The English phonemizer bundles eSpeak NG, which is GPL-3.0. That's fine for personal use; check it before you ship Lei to customers.

## What it can do on your computer

In companion mode, Lei is a JARVIS-style assistant for the computer it runs on. Ask it things like "how much disk space do I have?", "find the invoice from March", "make a folder for the trip and put a packing list in it", "turn the volume down", "open Spotify", "remind me to call Ana at six", or "what's the weather in Monterrey?".

Things it does right away:

- **Check the computer:** operating system, uptime, memory, free disk space.
- **Look through files:** list folders, find files by name, and read text files under your home folder (or `LEI_WORKSPACE`).
- **Open web pages** in your browser and **folders** in the file manager.
- **Reminders:** it says them out loud when they're due, and shows a desktop notification if the tab is in the background. A reminder that comes due while the page is closed is said the next time you open it.
- **Search the web** and read pages, for anything current.

Things it asks you about first, every time:

- **Write files:** create a file, replace one, or add to the end of one.
- **Run commands:** a shell command in your workspace (zsh on a Mac). On a Mac this includes `osascript` (control Music, the volume, Finder, Reminders) and `shortcuts run` (your Shortcuts).
- **Open files and apps**, since opening a file can run it.
- **Open web links after reading something from outside**, such as a web page, a search result, a file or a command's output. A page could tell her to put your data in a link, so once she has read one, links wait for your OK for the rest of that reply.

It shows a short line while it works ("Reading ~/notes.txt").

**How approval works.** Before acting, Lei shows a card with the exact command or file contents and asks out loud. Say "yes" or "no" (also "sí", "sim", "não"), or press **Allow** or **Don't allow**. The card gets an amber edge for commands that delete, move, overwrite or install things, and for replacing a file that already exists. If nobody answers within two minutes, the action is cancelled. Interrupting Lei cancels it too.

**What it never does:**

- It never runs `sudo`.
- It never reads or writes files that hold keys or passwords (`.ssh`, `.aws`, `.env`, `*.pem`, and similar), even with your OK.
- It never works outside the workspace folder.
- Commands don't get Lei's own API keys, or any other environment variable that looks like a key, token or password.
- A command is stopped after 60 seconds, and it can't ask for input.
- The server only answers its own page, so another website can't send it requests or approve anything.

Turn the computer tools off with `LEI_COMPUTER=off`, or web search with `LEI_WEB=off`. Point `LEI_WORKSPACE` at a smaller folder to keep Lei away from the rest of your files.

## Practice mode

`LEI_MODE=practice` turns Lei into an English speaking partner for Portuguese or Spanish speakers:

- Setup asks for the learner's level and goal instead of the companion questions.
- The interface is in the learner's language (`LEI_NATIVE_LANG`, default `es-MX`; `pt-BR` for Portuguese). Speech recognition and the voice use the language being practised (`LEI_TARGET_LANG`, default `en-US`).
- The partner keeps the conversation going in English. When the learner gets something wrong, it shows a correction card under their message, with a short explanation in their own language. Corrections are saved under **Memories** for review.
- Help in the learner's own language appears on screen in a quieter line and is not read aloud.

```bash
LEI_MODE=practice LEI_NATIVE_LANG=es-MX npm start
```

## Configuration

All settings are environment variables, read from `.env` if it exists:

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Claude credentials. Not needed if you've run `ant auth login`. |
| `LEI_MODE` | `companion` | `companion` or `practice` (see above). |
| `LEI_NATIVE_LANG` / `LEI_TARGET_LANG` | `es-MX` / `en-US` | Practice mode: the learner's language and the one being practised. |
| `LEI_COMPUTER` / `LEI_WEB` | on / on | Set to `off` to turn off the computer tools or web search (companion mode). |
| `LEI_WORKSPACE` | your home folder | The folder Lei may look through and, with your OK, work in. |
| `LEI_MODEL` | `claude-opus-5-5` | The Claude model. Haiku 5.5 costs about 40 times less per turn; test quality before switching. |
| `LEI_EFFORT` | `low` | How much the model thinks before answering. Higher is deeper but slower to reply. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Where the server listens. Keep it on localhost: anyone who can reach it spends your Claude credits. |
| `LEI_DATA_FILE` | `data/state.json` | Where the name, memories and conversation are saved. |
| `LEI_VOICE` | `auto` | Which voice speaks: `kokoro`, `elevenlabs`, `openai` (a local speech server) or `browser`. `auto` takes the first one that's set up, in that order: ElevenLabs, local server, Kokoro, browser. |
| `LEI_HEARING` | `auto` | Speech recognition: `local` (on this computer), or `browser`. `auto` is local when the models are downloaded. |
| `LEI_SMART_TURN` | on | Set to `off` to judge the end of your turn from the words only. |
| `LEI_VOICE_DIR` | `data/voices` | Where `npm run get-voice` puts the voice and speech recognition models. |
| `LEI_TTS_URL`, `LEI_TTS_VOICE` | none | A local speech server with OpenAI's API (e.g. `http://127.0.0.1:8880/v1`) and its voice names, comma-separated. `LEI_TTS_MODEL` (default `tts-1`) and `LEI_TTS_KEY` if it needs them. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | none | Optional. With both set, replies use an ElevenLabs voice. |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | The ElevenLabs model. |

## Privacy

- Your conversation, Lei's notes about you, and its name are stored in one JSON file on this computer (`data/state.json`). **Settings → Start over** deletes it. You can read or remove any single memory under **Memories**.
- What you say is sent to Claude to generate the reply, and so are the contents of any file Lei reads and its web searches.
- With the downloaded models, speech recognition runs on this computer and your voice never leaves it. Without them, your browser does it: Chrome sends the audio to Google's speech service, and Safari uses Apple's.
- Kokoro speaks on this computer, so the replies' text stays here. With ElevenLabs configured, the replies' text is sent to ElevenLabs to be spoken.

## Roadmap

[docs/roadmap.md](docs/roadmap.md) covers what similar projects do well, the voice options, running Lei on your phone and other computers, and the risks and security requirements to meet first.

## Development

```bash
npm run dev         # restarts the server when files change
npm test            # unit tests (node:test)
npm run typecheck   # tsc --noEmit
npm run check       # both
```
