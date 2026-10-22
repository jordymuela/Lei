# Lei: research and roadmap

Researched on 22 October 2026. Some sources couldn't be loaded directly; claims that rest on secondary reports or search excerpts are marked *(unverified)*.

## In short

- **Her voice is done.** Lei now has Kokoro, an open-source voice that runs inside Lei's server, built in. Run `npm run get-voice` once, then pick a voice in Settings. It's the top-ranked open model that allows commercial use on the Artificial Analysis leaderboard (read from search snapshots; Ming-3.0-tts may rank higher, but its license is unconfirmed), and it runs on a Mac CPU.
- **On your phone: feasible, as a web app.** Lei would be served from your Mac and reached only over Tailscale, your private network. It needs about 9–12 days of work, most of it security: login with passkeys, and stricter Host and Origin checks. **Don't expose Lei beyond localhost before that work is done.**
- **On all your computers: feasible.** One Mac is the "brain". Each other computer runs a small "hands" program that connects out to it and checks approvals itself. About 10–14 days.
- **The biggest risks:**
  - Exposing the server: projects like this have already had one-click takeovers.
  - Instructions hidden in web pages or files: one is now partly closed, because links opened after Lei reads outside text wait for your OK.
  - Approval fatigue: people click "allow" on almost everything.

## 1. What similar projects do well, and what Lei should copy

Projects studied:
- **Voice frameworks:** Pipecat, LiveKit Agents, Kyutai Unmute, TEN.
- **Assistants:** OpenClaw, Hermes Agent, Leon, Open Interpreter, Goose, OpenVoiceOS with HiveMind, Home Assistant Assist.
- **Memory systems:** Letta, mem0, Graphiti.
- **Hosted voice products:** OpenAI Realtime, Hume, ElevenLabs Agents, Sesame.

The lessons are ranked by how much more human or useful they would make Lei.

| # | What to copy | From | How, in Lei | Status |
|---|---|---|---|---|
| 1 | **A voice that sounds like a person** | Sesame, Kokoro | Kokoro in-process, one sentence at a time, with trimmed silences | **Done** |
| 2 | **Let you talk over her** | Pipecat, LiveKit, Hume, OpenClaw | While she speaks, open a second mic with echo cancellation and run a small voice detector in the browser (Silero via `@ricky0123/vad-web`). Speech lowers her volume, and two real words stop her. A lone "mm" or "yeah" lets her carry on. | Next |
| 3 | **Wait for the end of the thought, not a fixed pause** | LiveKit, OpenAI, ElevenLabs | Today the wait is 0.9 s or 2.2 s. Wait less after a finished sentence or a question, and longer after "and", "but" or "um". Learn your pace over time. Later: Pipecat's Smart Turn model (BSD, 8M parameters, ONNX) on the server. | Next |
| 4 | **No dead air** | OpenAI's "preambles", ElevenLabs | One short spoken line before any slow tool. If nothing has been said after about 1.5 s, a soft "hmm", at most once per reply. | Next |
| 5 | **Remember only what you heard** | Pipecat | On an interruption, save the reply only up to the last sentence actually spoken, so she doesn't "remember" saying things you never heard. | Next |
| 6 | **Layered memory** | OpenClaw, Leon, Letta, mem0 | Today: the last 60 facts as a flat list. Instead: a short curated profile that's always loaded, dated notes that are only ever added to, a `memory_search` tool, and a nightly tidy that marks old facts as superseded rather than deleting them. mem0 found that rewriting memories destroyed context. | Later |
| 7 | **A little proactivity, with manners** | Leon's "pulse" | At most one unprompted remark per time window, sent over the reminder channel. If you wave it off, she drops the topic. | Later |
| 8 | **Speak for the ear** | OpenClaw, Home Assistant | Code and long lists go on screen while she says "it's on screen". "Stop" and "what time is it" are answered without calling Claude. | Later |
| 9 | **Tighter approvals** | OpenClaw, Hermes | Approve the exact parsed command, folder and program, and check them again just before running. OpenClaw had a CVE where the approved text and the command that ran differed. Add a blocklist beyond `sudo`. **No "always allow"**: that is your call to make. | Later |
| 10 | **Satellites** | Leon, OpenClaw nodes, HiveMind | See section 3. | Phase 2 |

**Traps they hit:**
- **Echo cancellation may not cover Lei's own audio.** Browsers cancel echo for call audio. Whether they also cancel a page's `<audio>` or speech synthesis is unclear, and it varies by browser. Test barge-in on real hardware before relying on it, and require real words, not just sound, before stopping her.
- **Starting the reply before you finish speaking costs money.** Speculative replies doubled LLM calls in one LiveKit report.
- **Licenses.** LiveKit's turn-detector weights may only be used with LiveKit. TEN has extra restrictions.
- **Projects die.** Rhasspy 3 is archived and Vocode needs maintainers. Borrow ideas and small models, not frameworks.
- **Full-duplex speech-to-speech models** (Moshi, Unmute) need a big NVIDIA GPU. Not practical on a Mac yet.

## 2. The voice: what Lei uses and why

| Option | Quality | License | Runs on a Mac CPU | Languages | Role in Lei |
|---|---|---|---|---|---|
| **Kokoro-82M** | Highest-ranked open model that allows commercial use (Elo about 1065) | Apache-2.0 | Yes; well under 1 s per sentence | en; es and pt-BR (weaker) | **Built in** |
| Chatterbox (Resemble AI) | Expressive; emotion control; can clone voices | MIT; adds an audio watermark | Yes, through mlx-audio | 23 languages; Latin American Spanish and pt-BR versions | Through `LEI_TTS_URL` |
| Qwen3-TTS, VoxCPM2 | New; can design a voice from a description | Apache-2.0 | Through mlx-audio | es and pt | Through `LEI_TTS_URL` |
| Pocket TTS (Kyutai) | Streams with about 200 ms to first audio; clones voices | MIT code; CC-BY-4.0 weights *(unverified)* | Yes, about 6× real time | en, es, pt | Worth testing for phones and practice mode |
| ElevenLabs | Excellent | Paid cloud service | — | Many | Still supported |
| Fish S2, F5-TTS, XTTS, Spark, Voxtral | Some rank higher | **Non-commercial** | — | — | Avoid if you might sell Lei |

**How it's wired:**
- `server/kokoro.ts` runs the model with `onnxruntime-node`.
- The model files come from the kokoro-onnx GitHub release and are checked against SHA-256 hashes.
- English pronunciation uses the same rules as kokoro-js. Spanish and Portuguese use the `espeak-ng` program (`brew install espeak-ng`) with the symbol mapping from Kokoro's own G2P (text-to-phoneme) library, misaki. kokoro-js itself can't do those two languages.
- Any local server with OpenAI's speech API plugs in through `LEI_TTS_URL`. For maximum expressiveness on a Mac:

```bash
pip install "mlx-audio[server]"
mlx_audio.server --host 127.0.0.1 --port 8000
# .env
LEI_TTS_URL=http://127.0.0.1:8000/v1
LEI_TTS_MODEL=mlx-community/chatterbox-multilingual-v3
```

The package's extra name and the model id are from mlx-audio's README *(unverified)*; check them before relying on this.

**Measured here, on a slow 4-core cloud server:**
- Startup with the model: 3.4 s.
- About 1 s to make a 2-second sentence.
- Apple Silicon should be several times faster. Measure on your Mac.

**License note:**
- The voice model is Apache-2.0.
- Pronunciation uses eSpeak NG, which is GPL-3.0. For English it is bundled inside the `phonemizer` package. For Spanish and Portuguese it is a separate program.

That's fine for personal use. Get legal advice before selling a closed-source Lei.

## 3. Lei on your phone and on every computer

### Options

| Option | Verdict | Why |
|---|---|---|
| **Web app from your Mac over Tailscale** (`tailscale serve`) | **Go** | Real HTTPS, which phones require before a page can use the mic. Reachable only from your own devices. Tailscale adds who-is-calling headers. |
| Cloudflare Tunnel + Access, or ngrok + login | Second choice | Works, but the address is public and the provider sits in the middle. |
| Plain WireGuard or LAN IP | No | Without HTTPS, phones won't give the page the microphone. |
| **Tailscale Funnel** | **Never** | It puts Lei on the open internet. |
| Native app (Capacitor or Expo) | Later, only if needed | Adds background audio, native speech and push notifications. Costs 10–15 days plus Apple's yearly signing. |
| Telegram bot | Fallback, read-only | Cheap. Telegram can read bot chats. No computer actions through it. |
| WhatsApp bot | No | Meta's terms ban general-purpose AI assistants from 15 Jan 2026. |

### What phones can do (late 2026)

**Android Chrome**
- Speech recognition works, but continuous listening has no effect there. Lei must restart listening after each phrase.
- Audio goes to Google's servers.

**iPhone Safari**
- Recognition works in the browser tab.
- **Inside a home-screen app it's disputed.** A WebKit engineer said it isn't available; a 2026 developer report says it works on iOS 26.6. **Test on your phone first.**
- Recognition can silently stop after an `<audio>` element plays. Reports say playing her voice through the Web Audio API avoids this, so Lei's speaker will need an iOS path.

**Both platforms**
- Audio needs a tap to start.
- Screen wake lock and notifications work for home-screen apps (iOS 16.4+ for notifications).
- The mic stops when the app goes to the background. So "Hey Lei" only works while the app is open.
- Talking over her on phones is unreliable. Keep phones half-duplex: she talks, then listens.

**Siri:** a personal Shortcut works with no app. "Hey Siri, ask Lei" → Dictate Text → Get Contents of URL to your Mac over Tailscale.

### Architecture: one brain, many hands

```
Phone, laptops (web app)  ──HTTPS over Tailscale──▶  Hub: your Mac (Lei server)
                                                       holds the Claude key, memories, approvals
Other computers (lei-node) ──outbound WebSocket────▶  Hub
```

- **Hub:** today's Lei server.
  - Stays bound to 127.0.0.1, published only with `tailscale serve`.
  - The only place with the Claude key and the state file.
- **Clients:** the web page on any device. They only display things; voice settings are per device.
- **Nodes:** a small `lei-node` program on each other computer.
  - Reuses `computer.ts` and has **no** API key.
  - Connects *out* to the hub, so no computer opens a port. Similar projects either connect out (OpenClaw, HiveMind) or have the hub dial in (Home Assistant's now-deprecated Wyoming satellite).
- **Approvals: shown anywhere, checked where the action runs.**
  - The card can appear on your phone.
  - The node runs a command only with a passkey signature from one of your devices, over the exact command, the node and a nonce.
  - The node re-checks the workspace, secret-file and `sudo` rules itself. Then neither a hacked hub nor an injected instruction can swap the command after you approve it.
- **Where the hub runs:** an always-on Mac is recommended: private and free. A cloud server is always reachable, but it puts your transcripts and key on someone else's machine.

### Phased plan (one developer)

| Phase | Scope | Days |
|---|---|---|
| 0. Done now | Natural voice; approvals; links need approval after outside text | — |
| 1. Phone | <ul><li>`tailscale serve` with Host and Origin allowlists</li><li>Passkey pairing with one-time codes; login on every route; revoke a device</li><li>Face ID for risky approvals; installable web app</li><li>Push notifications for reminders</li><li>Android's restart-listening loop; iOS Web Audio playback</li><li>Daily spending cap; audit log</li><li>Testing on your real phone</li></ul> | 9–12 |
| 2. All computers | <ul><li>`lei-node` with pairing and an outbound connection</li><li>Signed approvals checked on the node</li><li>A "which computer" choice for tools</li><li>One reply at a time across devices</li><li>Reminders go to the device you used last</li></ul> | 10–14 |
| 3. Extras | <ul><li>Siri Shortcut endpoint (1–2)</li><li>Read-only Telegram (2–3)</li><li>Native app (10–15)</li><li>Wake word on desktops (3–5)</li></ul> | 3–25 |

Meanwhile the conversation improvements from section 1 (barge-in, smarter end of turn, no dead air, saving only what you heard) are about 4–6 days and are independent of all this.

## 4. Risks

L = likelihood, I = impact.

| Risk | L | I | What to do |
|---|---|---|---|
| Someone else reaches the server and runs commands | Medium if misconfigured | Critical | <ul><li>Tailscale only, never Funnel or port forwarding.</li><li>Login on every route; check Origin on every connection.</li><li>Refuse to start on a public address.</li><li>Precedent: OpenClaw had more than 21,000 exposed instances and a one-click takeover in 2026.</li></ul> |
| A web page or file tells Lei to do something | High | High | <ul><li>Done: links opened after outside text need approval.</li><li>Still open: web fetches to new sites. Treat anything she reads as untrusted ("the lethal trifecta": private data, untrusted content, a way to send data out).</li></ul> |
| Approval fatigue | High | High | <ul><li>Anthropic found people approve 93% of permission prompts.</li><li>Ask less, show exactly what changes, and save Face ID for risky actions.</li><li>Move files to the trash instead of overwriting.</li></ul> |
| A TV or bystander says "yes" | Medium | High | Allow a spoken yes only for low-risk actions; require a tap for the amber ones. |
| Lost or stolen phone | Low–Medium | High | Passkeys with Face ID, short sessions, revoke the device in Lei, and remove it in Tailscale's admin console (that revokes its key immediately). |
| API key leak | Low | Medium–High | Key only on the hub. Commands already get a cleaned environment. Rotate keys. |
| Runaway cost | Medium | Medium | A monthly limit in the Claude Console, plus a daily cap and rate limits in Lei. |
| Privacy | Medium | Medium–High | <ul><li>Browser speech recognition goes to Google or Apple.</li><li>Claude API inputs are kept up to 30 days by default.</li><li>Kokoro keeps her words local.</li><li>Rename the Mac before turning on Tailscale HTTPS: certificate names are public.</li><li>Use FileVault.</li></ul> |
| App store and platform rules change | Medium | Medium | Stay web-first. |

## 5. Before Lei listens on anything but localhost

These are hard requirements. Two parts of today's code would fail behind `tailscale serve`:
- `server/security.ts` only accepts localhost Hosts and `http://` Origins, so every request would be refused.
- Anyone who can POST `/api/chat` receives approval ids and could approve their own actions. `GET /api/state` returns memories without a login.

1. Keep the bind on 127.0.0.1. Publish only through `tailscale serve`. Refuse to start on a non-loopback `HOST`.
2. Allowlist exact Hosts (`localhost`, `127.0.0.1`, `<mac>.<tailnet>.ts.net`) and exact Origins, including the scheme.
3. Refuse requests carrying `Tailscale-Funnel-Request`. Require `Tailscale-User-Login` to be you; that's defence in depth only.
4. Login on **every** route, including state, events and static files, with one passkey per device. Enroll a device with a code shown on the Mac. Cookies: `HttpOnly; Secure; SameSite=Strict`. Keep a device list with revocation.
5. Only a logged-in device can answer approvals. Risky ones need Face ID or Touch ID over the exact action.
6. Rate limits and a daily spending budget.
7. An append-only audit log: who approved what, from which device.
8. Security headers: CSP `script-src 'self'`, `frame-ancestors 'none'` (so the approval card can't be clickjacked), `Referrer-Policy: no-referrer`, and HSTS.
9. Tailscale access rules (ACLs) so only your devices reach the hub, with key expiry on.
10. Tests for all of the above.

## 6. Legal notes (not legal advice)

- **Personal use is the easy case.** The EU AI Act exempts purely personal, non-professional use.
- **If you sell or share Lei:**
  - The EU AI Act's Article 50 has applied since 2 Aug 2026. Users must be told they're talking to an AI, and synthetic audio needs a machine-readable mark. That mark may be due later; sources conflict on the date.
  - California's SB 243 (in force since 1 Jan 2026) and New York's companion-AI law require an AI disclosure and a crisis-referral protocol. California also requires break reminders for minors.
- **Voice cloning needs recorded consent.** Tennessee's ELVIS Act and California's digital-replica laws apply. Never imitate a real person's voice.
- **Recording:** about 11 US states require everyone's consent. Listen only after you turn the mic on, show that it's on, and never store raw audio (Lei doesn't).

## 7. Test on real devices before building

- Speech recognition inside an iPhone home-screen app, on your iOS version.
- Whether playing her voice stops recognition on your iPhone, and whether the Web Audio API avoids it.
- Kokoro speed on your Mac. Expect well under half a second per sentence.
- Whether echo cancellation in your browser removes Lei's own voice. Barge-in depends on it.

## Sources

**Voice frameworks**
- Pipecat: https://github.com/pipecat-ai/pipecat
- Smart Turn: https://github.com/pipecat-ai/smart-turn
- LiveKit Agents: https://github.com/livekit/agents
- Kyutai Unmute: https://github.com/kyutai-labs/unmute
- TEN VAD: https://github.com/TEN-framework/ten-vad
- vad-web: https://github.com/ricky0123/vad

**Assistants**
- OpenClaw talk mode: https://github.com/openclaw/openclaw/blob/main/docs/nodes/talk.md
- OpenClaw exec approvals: https://github.com/openclaw/openclaw/blob/main/docs/tools/exec-approvals.md
- OpenClaw memory: https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md
- Leon: https://github.com/leon-ai/leon
- Hermes Agent: https://github.com/NousResearch/hermes-agent
- Goose: https://github.com/block/goose
- HiveMind: https://github.com/JarbasHiveMind/HiveMind-core
- Wyoming: https://github.com/rhasspy/wyoming

**Memory systems**
- Letta: https://github.com/letta-ai/letta
- mem0: https://github.com/mem0ai/mem0
- Graphiti: https://github.com/getzep/graphiti

**Voice models**
- Kokoro: https://github.com/hexgrad/kokoro
- kokoro-onnx: https://github.com/thewh1teagle/kokoro-onnx
- kokoro-js: https://www.npmjs.com/package/kokoro-js
- misaki (Kokoro's G2P library): https://pypi.org/project/misaki/
- Kokoro-FastAPI: https://github.com/remsky/Kokoro-FastAPI
- Chatterbox: https://github.com/resemble-ai/chatterbox
- Chatterbox-TTS-Server: https://github.com/devnen/Chatterbox-TTS-Server
- mlx-audio: https://github.com/Blaizzy/mlx-audio
- Pocket TTS: https://github.com/kyutai-labs/pocket-tts
- Qwen3-TTS: https://github.com/QwenLM/Qwen3-TTS
- Leaderboard: https://artificialanalysis.ai/text-to-speech/leaderboard *(read from search snapshots)*

**Phones and networking**
- Tailscale Serve: https://tailscale.com/kb/1312/serve
- Tailscale Serve source (forwarded headers): https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go
- Tailscale Funnel: https://tailscale.com/kb/1223/funnel
- `ts.net` on the Public Suffix List: https://github.com/publicsuffix/list
- Speech recognition browser support: https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json
- WebKit bug on home-screen apps: https://bugs.webkit.org/show_bug.cgi?id=225298
- Web Speech API issue 96: https://github.com/WebAudio/web-speech-api/issues/96
- Web Push on iOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WhatsApp AI-assistant ban: https://respond.io/blog/whatsapp-general-purpose-chatbots-ban

**Security**
- OpenClaw one-click RCE: https://thehackernews.com/2026/02/openclaw-bug-enables-one-click-remote.html
- OpenClaw CVE-2026-26325: https://osv.dev/vulnerability/CVE-2026-26325
- The lethal trifecta: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- OWASP LLM01, prompt injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- Approval rates: https://www.anthropic.com/engineering/claude-code-auto-mode

**Legal**
- EU AI Act Article 50: https://artificialintelligenceact.eu/article/50/
- EU AI Act Article 2: https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-2
- California SB 243 and the New York law: https://fpf.org/blog/understanding-the-new-wave-of-chatbot-legislation-california-sb-243-and-beyond/
