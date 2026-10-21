# Lei

A voice-first AI companion inspired by the film *Her*, built on Claude. You talk out loud; it answers out loud. On first run it asks you four questions, picks its own name, and greets you. After that it remembers what matters to you, picks up where you left off when you come back, and now and then composes a little piano piece.

## Requirements

- Node.js 22.18 or newer. The server is TypeScript that Node runs directly, so there is no build step.
- A Claude API key, or an `ant auth login` profile on this machine.
- Chrome, Edge or Safari for talking out loud. Other browsers can still type, and replies are still spoken.

## Run it

```bash
npm install
cp .env.example .env    # then put your ANTHROPIC_API_KEY in .env
npm start               # http://127.0.0.1:3000
```

Open the page, go through setup, then tap the mic and talk. Lei listens until you pause, answers, and starts listening again once it has finished speaking. To cut it off, tap the figure or press Esc.

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
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | none | Optional. With both set, replies use an ElevenLabs voice instead of the browser's built-in voices. |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | The ElevenLabs model. |

## Privacy

- Your conversation, Lei's notes about you, and its name are stored in one JSON file on this computer (`data/state.json`). **Settings → Start over** deletes it. You can read or remove any single memory under **Memories**.
- What you say is sent to Claude to generate the reply, and so are the contents of any file Lei reads and its web searches.
- Speech recognition is done by your browser. Chrome sends the audio to Google's speech service; Safari uses Apple's.
- With ElevenLabs configured, the replies' text is sent to ElevenLabs to be spoken.

## Development

```bash
npm run dev         # restarts the server when files change
npm test            # unit tests (node:test)
npm run typecheck   # tsc --noEmit
npm run check       # both
```
