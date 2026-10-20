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
| `LEI_MODEL` | `claude-opus-5-5` | The Claude model. Haiku 5.5 costs about 40 times less per turn; test quality before switching. |
| `LEI_EFFORT` | `low` | How much the model thinks before answering. Higher is deeper but slower to reply. |
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Where the server listens. Keep it on localhost: anyone who can reach it spends your Claude credits. |
| `LEI_DATA_FILE` | `data/state.json` | Where the name, memories and conversation are saved. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | none | Optional. With both set, replies use an ElevenLabs voice instead of the browser's built-in voices. |
| `ELEVENLABS_MODEL` | `eleven_flash_v2_5` | The ElevenLabs model. |

## Privacy

- Your conversation, Lei's notes about you, and its name are stored in one JSON file on this computer (`data/state.json`). **Settings → Start over** deletes it. You can read or remove any single memory under **Memories**.
- What you say is sent to Claude to generate the reply.
- Speech recognition is done by your browser. Chrome sends the audio to Google's speech service; Safari uses Apple's.
- With ElevenLabs configured, the replies' text is sent to ElevenLabs to be spoken.

## Development

```bash
npm run dev         # restarts the server when files change
npm test            # unit tests (node:test)
npm run typecheck   # tsc --noEmit
npm run check       # both
```
