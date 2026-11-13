// Usage: node scripts/e2e/make-mic.ts fake-mic.wav && node scripts/e2e/talk.cjs fake-mic.wav
// End to end: a WAV file is the microphone; Lei hears it on the server (Parakeet), answers through a
// fake Claude, speaks with Kokoro, gets talked over, stops, and saves only what was heard.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lei-e2e-'));
const REPO = path.resolve(__dirname, '../..');
const STATE = DIR + '/talk-state.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const at = () => ((Date.now() - T0) / 1000).toFixed(2) + 's';

const REPLY = "Lisbon is sunny today, about twenty-two degrees. There's a light breeze from the ocean in the afternoon. It's a great day for a walk along the river, and the light is lovely around sunset. You might want sunglasses, and maybe a light jacket for the evening.";
const asked = [];
function sse(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: 'm' + asked.length, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  // Stream word by word, like a model does.
  const words = text.split(/(?<= )/);
  let i = 0;
  const tick = setInterval(() => {
    if (res.destroyed) return clearInterval(tick);
    if (i < words.length) return ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: words[i++] } });
    clearInterval(tick);
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  }, 25);
}
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const r = JSON.parse(body);
    const last = r.messages.at(-1);
    const said = typeof last.content === 'string' ? last.content : last.content.map((b) => b.text || '').join('');
    asked.push(said);
    console.log(at(), 'claude asked:', JSON.stringify(said));
    setTimeout(() => sse(res, asked.length === 1 ? REPLY : 'Porto is cloudier, around eighteen degrees.'), 600);
  });
});

(async () => {
  await new Promise((r) => fake.listen(3399, '127.0.0.1', r));
  const now = Date.now();
  fs.writeFileSync(STATE, JSON.stringify({
    profile: { userName: 'Jordy', about: 'builder', onMind: '', companionName: 'Lei', createdAt: now - 864e5 },
    memories: [], corrections: [], reminders: [],
    transcript: [{ role: 'assistant', text: "Hi Jordy. I'm Lei.", at: now - 6e4 }],
  }));
  const srv = spawn(process.execPath, ['server/index.ts'], {
    cwd: REPO,
    env: { ...process.env, PORT: '3325', LEI_DATA_FILE: STATE, LEI_WEB: 'off', ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: 'http://127.0.0.1:3399' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  while (!log.includes('listening on') && Date.now() - T0 < 60000) await sleep(200);
  console.log(at(), log.split('\n').find((l) => l.includes('listening on')));

  const b = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.argv[2] || path.join(REPO, 'fake-mic.wav')}%noloop`],
  });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['microphone'], { origin: 'http://127.0.0.1:3325' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
    if (m.text().startsWith('[lei]')) console.log(at(), 'page:', m.text());
  });
  p.on('websocket', (ws) => {
    console.log(at(), 'ws open', ws.url());
    ws.on('framereceived', (f) => {
      const d = String(f.payload);
      if (!d.includes('"partial"')) console.log(at(), 'ws <-', d);
    });
  });
  p.on('request', (r) => {
    const u = r.url();
    if (u.endsWith('/api/chat') || u.endsWith('/api/heard')) console.log(at(), r.method(), u.replace(/.*\/api/, '/api'), r.postData());
  });
  let tts = 0;
  p.on('requestfinished', (r) => r.url().endsWith('/api/tts') && tts++);
  await p.goto('http://127.0.0.1:3325/?debug');
  await sleep(1000);
  const micT = Date.now();
  await p.click('#micBtn');
  console.log(at(), 'mic on (fake mic starts playing now)');
  await sleep(26000);
  await p.screenshot({ path: path.join(DIR, 'talk-check.png') });
  const saved = JSON.parse(fs.readFileSync(STATE, 'utf8')).transcript.map((m) => `${m.role}: ${m.text}`);
  console.log('\nsaved transcript:\n  ' + saved.join('\n  '));
  console.log('tts clips fetched:', tts, '| errors:', JSON.stringify(errs));
  console.log('server log tail:\n' + log.split('\n').filter((l) => l.startsWith('[')).slice(-6).join('\n'));
  await b.close();
  srv.kill();
  fake.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
