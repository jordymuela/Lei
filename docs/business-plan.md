# Lei: business plan

Written 13 November 2026 by the founder (Claude) for the cofounder. Market numbers come from research done the same day; sources are at the end, and *(unverified)* marks the soft ones.

## The decision

**We sell spoken English practice to Mexicans who need English for work, starting with job interviews. We keep Lei for Mac (the JARVIS) as our own product and our proof of craft, and don't try to sell it yet.**

Why:

1. **People already pay for this, in Mexico, now.**
   - Speak launched in Mexico in April 2026 at MXN 199/month or MXN 999/year.
   - Duolingo is moving its video-call practice into its cheaper Super plan.
   - The category is proven. Our job is to win a slice of it, not to prove it exists.
2. **Our edge is the conversation itself.** It's exactly what we just built:
   - She knows you've finished in a third of a second.
   - You can talk over her, and "mm-hm" doesn't stop her.
   - Her voice sounds human, and she remembers you.
   - Speaking apps live or die on whether talking feels natural, and most still feel like walkie-talkies.
3. **The wedge has money behind it.**
   - Nearshoring has created jobs that require spoken English: customer support, IT and sales for US companies.
   - Mexico ranks 103rd in EF's English Proficiency Index.
   - "Pass your English interview" is a goal with a date and a salary attached. People pay faster for that than for "learn English someday".
4. **The desktop JARVIS is a hard business today.**
   - OpenClaw is free and has about 393,000 GitHub stars.
   - Claude, ChatGPT and Raycast sell assistants for $8–20/month.
   - Lei for Mac stays our daily driver and our showcase. We revisit selling it once the practice product has paying users.

## The product: "Lei" for interview and work English

- **Who:** Mexican adults (18+) applying for, or already in, jobs that need spoken English. Later, Brazil.
- **What:**
  - Talk out loud with Lei in practice mode, with the same voice stack.
  - Short, gentle corrections, explained in Spanish.
  - Role-played interviews for a specific job ("customer support at a US software company"), with a score and three things to fix after each session.
  - She remembers your goals and your recurring mistakes.
- **Where:** a web app (installable PWA) first, then Android (78% of Mexican phones), then iOS (21%), using our developer account.
- **Not:** a romantic or "Her"-style companion. Practice mode stays a tutor. That avoids the companion-chatbot rules (California SB 243, New York) and Apple's 18+ rating for companion apps.

## Pricing

Mexico first. Prices sit just under Speak (MXN 199) and in line with ChatGPT Go (MXN 110–129) and Gemini AI Plus (MXN 99).

| Plan | Price | Notes |
|---|---|---|
| Free | 3 full conversations, then 5 minutes a day | Enough to feel the difference |
| Lei Plus, monthly | **MXN 149** | Card or Mercado Pago, recurring |
| Lei Plus, yearly | **MXN 999** | The plan to push: cash now, and only about a quarter of annual subscribers renew anyway |
| Interview Sprint | **MXN 249 for 30 days** | One-time payment by OXXO, SPEI or card. Fits people without a card, and the date-driven goal |
| Brazil (later) | R$29.90/month, R$249.90/year | Pix Automático through Stripe |
| Companies (later) | about US$8–10 per seat per month | BPOs and staffing agencies |

**Selling on the web keeps the margin.**
- Apple and Google take 15% of in-app subscriptions under their small-business programs.
- Apple allows selling on the web and unlocking in the app (guideline 3.1.3(b)), as long as the app also offers in-app purchase.
- In Mexico the app can't link to the web checkout, but we can market it everywhere else: WhatsApp, email, TikTok.

## Unit economics

Measured from Lei's real prompts:
- About 2,450 input and 210 output tokens per turn (including low-effort thinking).
- 20 turns per 10-minute conversation.
- At this prompt size caching may not apply, so I priced everything uncached.

| Claude model | Cost per conversation | Per payer per month (12 conversations) | Share of MXN 149 (≈US$8) |
|---|---|---|---|
| Opus 5.5 ($4 / $20 per MTok) | $0.28 | $3.40 | 42% |
| Sonnet 5.5 ($2 / $10) | $0.14 | $1.70 | 21% |
| **Haiku 5.5 ($0.10 / $0.50)** | **$0.007** | **$0.08** | **1%** |

**So the practice product runs on Haiku 5.5, if it holds up.**
- The first engineering task is an eval: Haiku against Sonnet on 50 real practice transcripts, judging correction quality and naturalness.
- If Haiku falls short on corrections only, Haiku can hold the conversation while Sonnet writes the end-of-session feedback (about $0.01 a session).

**Other costs:**
- **Voice:** hosted Parakeet + Kokoro on CPU. My estimate is under $0.005 per conversation (one 8-core server for 10–20 parallel conversations); measure it in the beta.
- **Payments:** about 4–5%; get quotes from Stripe and Mercado Pago.
- **Gross margin:** about 90% sold on the web, about 80% through app stores.

**The hard part is acquisition, not serving costs.**

| Input | Number |
|---|---|
| Cost per install, Mexico | about $1.10 |
| Typical install-to-paid rate | 2–3% for freemium, about 11% with a hard paywall |
| Cost per paying user (CPI ÷ conversion) | about $37 |
| Lifetime value of a monthly payer (about 5 months × $7.60) | about $36 |

- **Paid ads don't pay back at the start.** We grow on creators, word of mouth, referrals and partners until conversion is proven, and we push the yearly plan.
- **Target:** at least 6% install-to-paid, with a paywall after the third free conversation, which roughly halves the cost per payer.

## Going to market

1. **Creators.** Mexican TikTok and Instagram creators who make career, English or job-hunting content. Micro-creators cost about $200–1,500 per video *(unverified)*. Five of them, with their own discount codes.
2. **Partners who already have our users.**
   - Bootcamps, university career offices and staffing agencies placing people in nearshoring jobs.
   - BPOs and call centers, which pay to train their agents' English.
   - One 200-seat contract is about US$2,000 a month.
3. **WhatsApp.** Daily practice nudges and streaks, where Mexicans actually are; about $0.04 per marketing message.
4. **Search.** Spanish pages answering "how to prepare for an English job interview", with a free practice interview.

## The next 90 days

| Weeks | What | Who | Gate to continue |
|---|---|---|---|
| 1–2 | Spanish landing page with a waitlist. 20 interviews with job seekers and 5 with BPOs or recruiters. Choose the three interview tracks. | Cofounder leads; I draft scripts and copy | 300+ on the waitlist from $300 of creator posts; at least 3 recruiters say they'd pilot it |
| 1–4 | **Hosted beta**: accounts, a separate memory per person, Haiku with the eval, and the interview mode. Built from this codebase (see HANDOFF.md, track B) | Me, through Claude Code on the Mac | Eval: Haiku within 10% of Sonnet on correction quality |
| 5–8 | Beta with 100 people, free. Price test (MXN 99, 149, 199) through the web checkout | Both | Day-7 retention ≥ 25%; ≥ 3 conversations a week; ≥ 6% pay at the end of the trial |
| 9–12 | Android app (a wrapped PWA), paid launch in Mexico, first B2B pilot | Both | 100 paying users; one signed pilot |

**What we stop if it fails:**
- If day-7 retention stays under 15% after two product iterations, the conversation isn't good enough yet, and we go back to the product.
- If fewer than 2% pay, we test the Sprint and B2B before spending on ads.

**Budget for the 90 days:** about US$3–5k.
- Creators and ads: $1,500–2,500
- Servers: about $100 a month
- Claude API: under $200
- Privacy policy, terms and company setup: about $500–1,000
- The Apple account we already have

## Legal and trust (practice product)

- **Adults only (18+) at launch.** Brazil's ECA Digital (in force since March 2026) no longer accepts a self-declared age, and minors bring extra duties everywhere.
- **Tell people it's an AI.** In the app and in her first line; required in the EU (AI Act Art. 50) and expected everywhere.
- **Cancelling:**
  - Mexico: one-click cancel, plus a reminder 5 days before each renewal.
  - Brazil: a 7-day right to withdraw.
- **Privacy:**
  - Speech recognition runs on our servers; we never store raw audio.
  - Transcripts go to Anthropic's API, which keeps them up to 30 days by default.
  - Our privacy policy says so in Spanish and Portuguese.
- **App stores:** say that data goes to a third-party AI and ask permission (Apple 5.1.2(i)). Give people a way to report a bad AI answer (Google Play).

## Lei for Mac (the JARVIS): what happens to it

- It stays our daily tool and the place we try new ideas first: faster turn-taking, voices, approvals. The phone work now lets one of us use it everywhere.
- **Month 6 decision**, once the practice product has paying users. Choose one:
  1. Open-source it to build a community and credibility, with a paid "Lei Cloud" later for hosted keys, sync and backups at about $12–15/month.
  2. Sell it as a Mac app (about $8/month, or bring your own Claude key).
- On Opus 5.5, a heavy desktop user costs about $15/month in API fees. So any paid version uses Sonnet 5.5 for routine turns, or the user's own key.

## What I need from you this week

1. **Register the company** and open a business account that can receive Stripe and Mercado Pago payments in Mexico.
2. **Book 20 job-seeker interviews and 5 recruiter or BPO calls.** I'll write the script; you run them, in Spanish.
3. **Pick five creators** in the career and English niche and get their rates.
4. **Get Lei running on your Mac** with the handoff (HANDOFF.md) and use it daily for a week. Write down every moment it feels robotic.
5. **Reserve the name.** Check the domain and social handles for "Lei" plus a Spanish product name, e.g. "Lei: inglés para tu entrevista".

## Sources

**Competitor prices**
- Speak, Mexico: https://www.xataka.com.mx/educacion/esta-app-idiomas-llega-a-mexico-para-competir-duolingo-idea-tener-tutor-ia-24-7
- Speak, Brazil: https://apps.apple.com/BR/app/id1286609883
- ChatGPT Go, Mexico: https://geotoolbox.ai/es/blog/precio-chatgpt
- Gemini, Mexico: https://gemini.google/mx/subscriptions/?hl=es-MX
- Duolingo Q3 2026 filing: https://www.sec.gov/Archives/edgar/data/0001562088/000162828026069692/duol-20260930.htm

**Platforms and payments**
- Phone OS share, Mexico: https://gs.statcounter.com/os-market-share/mobile-/mexico/2026
- App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple payment options in Brazil: https://developer.apple.com/support/payment-options-on-the-app-store-in-brazil
- Google Play fees: https://support.google.com/googleplay/android-developer/answer/112622
- Pix Automático: https://docs.stripe.com/payments/pix/pix-automatico
- OXXO: https://docs.stripe.com/payments/oxxo

**Acquisition and retention**
- Subscription app benchmarks: https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026
- Apple Ads benchmarks: https://www.apptweak.com/en/aso-blog/apple-ads-benchmarks

**Demand**
- EF English Proficiency Index, Mexico: https://www.ef.com/assetscdn/WIBIwq6RdJvcD9bc8RMd/cefcom-epi-site/fact-sheets/2025/ef-epi-fact-sheet-mexico-english.pdf

**Rules**
- California SB 243: https://www.ashurstperkinscoie.com/en/insights/california-companion-chatbot-law-now-in-effect/
- EU AI Act transparency duties: https://www.goodwinlaw.com/en/insights/publications/2026/08/alerts-technology-dpc-eu-ai-act-transparency-obligations-now-in-force
- Brazil ECA Digital: https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/direito-digital/estatuto-digital-da-crianca-e-do-adolescente-lei-n-15-211-2025-entra-em-vigor-em-17-de-marco-de-2026
- Mexico's click-to-cancel rules: https://www.xataka.com.mx/legislacion-y-derechos/a-partir-hoy-debe-ser-facil-cancelar-servicios-suscripciones-mexico-multaran

**Claude API prices** are Anthropic's published rates as of November 2026.
