# Handoff: carrying Lei forward on the Mac

For a Claude Code agent working in a terminal on the owner's Mac. It was written at the end of a cloud session that couldn't touch real audio hardware, a phone, Tailscale or the real Claude API. Your job is to make Lei solid on real devices, then build the hosted practice beta (see `docs/business-plan.md`).

## Paste this into Claude Code on the Mac

```
You're continuing work on Lei, a voice-first AI companion (repo: jordymuela/Lei, branch `jarvis`).
Read CLAUDE.md, then docs/HANDOFF.md, docs/business-plan.md and docs/roadmap.md.
Start with Track A in HANDOFF.md, in order. Before each task, tell me what you'll
check and what you need from me (e.g. "speak these 5 sentences", "open this on your
iPhone"). Write what you measure into docs/measurements.md. Commit to `jarvis` as you go.
Don't merge into main, push anywhere else, use `tailscale funnel`, or weaken any safety
rule in CLAUDE.md without asking me first.
```

## Where things stand

**Built and tested in the cloud** (Linux, no speakers, mic or phone; the Claude API was faked, Chromium used WAV files as its microphone):

- **Companion and practice modes** on Claude Opus 5.5.
  - Memories and reminders.
  - Computer tools: reading is free; writes, commands and opening apps wait for approval every time.
  - Links opened after reading outside content need approval too.
- **Her voice:** Kokoro (open source), running in the server.
  - About 1 s to make 2 s of speech on the cloud CPU.
  - Spanish and Portuguese voices with `espeak-ng`.
  - Voice speed is handled by the voice itself; failed clips fall back to the browser voice.
- **Her ears:** local speech recognition (Parakeet v3 + Silero VAD), streamed over a WebSocket.
  - Transcripts in about 0.2 s on the cloud CPU.
  - The turn ends 0.32–0.42 s after a finished question; "and…" waits.
  - Smart Turn v3.2 judges from the voice whether you've finished.
- **Talking over her:** her voice ducks, "wait" or two real words stop her, "mm-hm" doesn't, and her own echo is ignored.
  - Interrupted replies are saved only up to what was heard.
  - A "Hmm." fills a slow start.
- **Phone access:** a separate loopback port for `tailscale serve`.
  - Host allowlist; Funnel refused.
  - Device pairing with one-time codes; HttpOnly session cookies; revoking a device works.
  - The mic WebSocket and reminders are checked the same way.
  - Audit log; spoken "yes" refused for risky actions.
  - Installable as a PWA (manifest and icons); screen wake lock.
- **Tests:** `npm run check`, 92 tests, no network needed.
  - Tests that use real models run only when `npm run get-voice` has downloaded them.
  - Browser checks: `scripts/e2e/` (see below).

**Not checked yet, and the reason you exist:**

1. **Speed on Apple Silicon:** Kokoro per sentence, Parakeet per utterance, Smart Turn per pause, end-to-end with the real Claude API.
2. **Talking over her through laptop speakers.** Does the browser's echo cancellation remove her voice, and does the echo filter cope when it doesn't?
3. **Smart Turn thresholds on real human voices.** On synthetic speech it sometimes split "Wait, actually, stop. What about Porto?" into two turns: it ended the turn about 0.2 s after "stop.".
4. **iPhone Safari as an installed home-screen app:**
   - Mic permission.
   - AudioWorklet and a `wss://` WebSocket.
   - Whether her voice plays through the speaker or the earpiece while the mic is open.
   - What happens when the screen locks.
5. **The `tailscale serve` command.** The docs say `tailscale serve --bg 3001`; confirm it on the current Tailscale version.
6. **Real Claude API turns.** The persona's cut-off "…" note; first-word latency at effort `low`.

## Setup on the Mac

```bash
git clone https://github.com/jordymuela/Lei.git lei && cd lei && git checkout jarvis
npm install                 # includes onnxruntime-node and sherpa-onnx (native, Apple Silicon builds)
npm run get-voice           # about 860 MB; every file is checked against pinned SHA-256 hashes
brew install espeak-ng      # optional: Spanish and Portuguese voices
cp .env.example .env        # add ANTHROPIC_API_KEY (or run `ant auth login`)
npm run check               # all tests, including the real-model ones once the models are downloaded
npm start                   # http://127.0.0.1:3000 ; add ?debug to see turn timings
```

## Track A: make it solid on real devices (do first, in order)

**A1. Measure on the Mac.**
- Run the app with `?debug` and have the owner hold 10 short conversations: questions, trailing "and…", long stories.
- Record per turn: "heard you N ms after you stopped", transcription ms, first words, voice start.
- Also record Kokoro ms per sentence and CPU use.
- *Done when:* `docs/measurements.md` has a table of real numbers, and the README's timing claims match them or are corrected.

**A2. Tune turn-taking and talking over her with real voices.**
- Try both speakers and headphones.
- Test cases:
  - "mm-hm" while she talks: she keeps going.
  - "wait": she stops within about 0.5 s.
  - A long sentence over her: she stops, and it becomes the next message.
  - Her own voice from the speakers: never a false stop.
  - Two sentences with a short pause: one turn or two?
- What to tune:
  - `endOfTurnWait()` thresholds in `public/js/lib/turns.js` (Smart Turn ≥0.85 → 200 ms is the aggressive one).
  - `PARTIAL_OVER_HER` and `ECHO_TAIL` in `server/listening.ts`.
- Extend `test/listening.test.ts` for each behaviour you change.
- If echo cancellation fails with speakers, consider requesting `echoCancellation: "all"` where the browser supports it.
- *Done when:* the 5 cases behave right in 4 of 5 tries each, and the tests cover the new thresholds.

**A3. iPhone over Tailscale.** Follow the README section "Lei on your phone".
- Steps:
  1. Pair the phone.
  2. Add Lei to the home screen.
  3. Have a spoken conversation with the mic on.
  4. Talk over her.
  5. Approve a harmless action (e.g. "make a file called test.txt on my Desktop").
  6. Lock the screen and come back.
- *Done when:* each step's result (works / broken / workaround) is in `docs/measurements.md`, with fixes made for anything broken in the web app.
- If the installed app can't keep the mic, WebSocket or audio working, go to A5.

**A4. Open a pull request** from `jarvis` to `main` with a summary of tracks done so far. Don't merge; the owner reviews.

**A5 (only if A3 shows the web app can't do it). A thin native iOS wrapper.** The owner has an Apple developer account.
- **Project:** SwiftUI app with one `WKWebView` on the tailnet URL. Generate the project with XcodeGen (`project.yml`) rather than hand-writing `.pbxproj`.
- **Web view setup:**
  - `allowsInlineMediaPlayback = true`
  - `mediaTypesRequiringUserActionForPlayback = []`
  - A `WKUIDelegate` that grants `requestMediaCapturePermissionFor` **only** for the tailnet host.
  - Navigation restricted to that host.
- **Audio:** `AVAudioSession` category `.playAndRecord` with `.defaultToSpeaker` and `.allowBluetooth`, mode `.voiceChat` (hardware echo cancellation).
- **Info.plist:** `NSMicrophoneUsageDescription`. Mention third-party AI processing (App Store guideline 5.1.2(i)).
- Ship to the owner's phone through TestFlight.
- *Done when:* the A3 checklist passes in the wrapper.

## Track B: the business (see docs/business-plan.md)

**B0. Eval: Haiku 5.5 vs Sonnet 5.5 for practice mode.**
- Use the `claude-api` skill's `build-eval` flow, on about 50 practice-mode conversations (the owner and friends can make them).
- Judge correction accuracy, naturalness, and following the [Spanish aside] rule.
- Get the owner's OK before spending on runs.
- *Done when:* there's a recommendation with numbers. Our unit economics assume Haiku 5.5.

**B1. Hosted practice beta.** Design first: write `docs/hosted-design.md` and get it approved before coding. It has to cover:
- **Accounts** (email magic link or passkeys) and **per-user state** (a store per user, or SQLite).
- **Practice mode only.** The computer tools, web tools and approvals must not exist in this build at all, not just be switched off.
- **Interview mode:** role-played interviews for a job, with a short scored summary after each session.
- **Limits:** minutes per day for free users, plus rate limits.
- **Billing:** Stripe for cards; Mercado Pago and OXXO/SPEI for 30-day passes. Webhooks must be idempotent.
- **Hosting:** CPU servers for Parakeet and Kokoro, with costs measured.
- **Privacy and AI disclosure** in Spanish; 18+ only; cancelling rules for Mexico.
- **Reuse:** voice, hearing, turns and the speaker as they are.

**B2. Spanish landing page with a waitlist.** It can be a static page; the cofounder writes the copy with you.

## Track C: later

- **C1. Reminders while the page is closed:** a service worker and Web Push (VAPID). On iPhone this needs the home-screen app.
- **C2. Face ID for risky approvals from remote devices:**
  - Passkeys via `@simplewebauthn/server`, with the RP ID set to the tailnet name.
  - The challenge binds the approval id and the exact detail.
  - Test with Playwright's virtual authenticator.
- **C3. A daily spending cap:** count tokens from `usage`, show them in Settings, and refuse new turns past the cap.
- **C4. Other computers as "hands"** (`lei-node`). See `docs/roadmap.md`, section 3.

## Browser checks (scripts/e2e)

Real Chromium against the real server, with a fake Claude endpoint (`ANTHROPIC_BASE_URL` pointed at a tiny local server that streams SSE events):

```bash
npm i -D playwright && npx playwright install chromium      # once
node scripts/e2e/make-mic.ts fake-mic.wav                    # a "person" asking, then talking over her
node scripts/e2e/talk.cjs fake-mic.wav                       # hears, answers, gets interrupted, saves only what was heard
node scripts/e2e/pair.cjs                                    # pairs a phone-sized browser, then revokes it
```

`talk.cjs` uses Chromium's `--use-file-for-fake-audio-capture`. `pair.cjs` maps a fake tailnet name to localhost with `--host-resolver-rules` and treats it as secure. Both print JSON you can compare before and after a change.

## Rules that must survive (also in CLAUDE.md)

- Every change to the computer goes through an approval card; there's no "always allow". Risky actions need a tap, not a spoken "yes".
- The remote port listens on 127.0.0.1 only and requires a paired device on every route. The mic WebSocket requires a matching Origin. Never `tailscale funnel`.
- Secret files stay off limits; `sudo` is refused; Lei's keys are stripped from command environments.
- Model downloads are checked against pinned hashes. If you change a model, pin its hash.
- `npm run check` passes before every commit, and tests need no network.
- Commit on `jarvis`. Ask before pushing to `main` or opening anything public.
