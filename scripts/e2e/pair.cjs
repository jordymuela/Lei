// Usage: node scripts/e2e/pair.cjs
// Pairing a phone end to end: the Mac's page makes a code; a phone-sized browser reaching Lei by its
// tailnet name pairs with it, talks to Lei, and is signed out when the Mac removes it.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lei-e2e-'));
const REPO = path.resolve(__dirname, '../..');
const STATE = DIR + '/pair-state.json';
const NAME = 'lei-mac.tail1234.ts.net';
const LOCAL = 3331, REMOTE = 3332;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fake = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: "Hi from your Mac. I can hear you on your phone." } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  });
});

(async () => {
  await new Promise((r) => fake.listen(3398, '127.0.0.1', r));
  const now = Date.now();
  fs.writeFileSync(STATE, JSON.stringify({
    profile: { userName: 'Jordy', about: 'builder', onMind: '', companionName: 'Lei', createdAt: now - 864e5 },
    memories: [], corrections: [], reminders: [], devices: [],
    transcript: [{ role: 'assistant', text: "Hi Jordy. I'm Lei.", at: now - 6e4 }],
  }));
  const srv = spawn(process.execPath, ['server/index.ts'], {
    cwd: REPO,
    env: { ...process.env, PORT: String(LOCAL), LEI_REMOTE_PORT: String(REMOTE), LEI_REMOTE_HOSTS: NAME, LEI_DATA_FILE: STATE, LEI_WEB: 'off', ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: 'http://127.0.0.1:3398' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  while (!log.includes('Lei is listening')) await sleep(200);
  const out = { startup: log.split('\n').filter((l) => /Phones|listening on/.test(l)) };

  const phoneOrigin = `http://${NAME}:${REMOTE}`;
  const b = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${phoneOrigin}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const errs = [];
  const mac = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
  const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1' });
  const phone = await phoneCtx.newPage();
  for (const [who, p] of [['mac', mac], ['phone', phone]]) {
    p.on('pageerror', (e) => errs.push(`${who}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && !/401/.test(m.text()) && errs.push(`${who}: ${m.text()}`));
  }

  // The phone, unpaired, lands on the pairing page.
  await phone.goto(phoneOrigin + '/');
  out.phoneLandedOn = new URL(phone.url()).pathname;
  await phone.screenshot({ path: path.join(DIR, 'pair-phone.png') });

  // The Mac makes a code in Settings → Devices.
  await mac.goto(`http://127.0.0.1:${LOCAL}/`);
  await sleep(800);
  await mac.click('#setBtn');
  await mac.waitForSelector('#addDeviceBtn:not([hidden])', { timeout: 5000 });
  await mac.click('#addDeviceBtn');
  await mac.waitForSelector('#pairBox:not([hidden])');
  const code = (await mac.textContent('#pairCode')).replace(/\s/g, '');
  out.macSteps = await mac.textContent('#pairSteps');
  await mac.screenshot({ path: path.join(DIR, 'pair-mac.png') });

  // A wrong code first, then the right one.
  await phone.fill('#code', code === '000000' ? '111111' : '000000');
  await phone.click('#pairBtn');
  await sleep(500);
  out.wrongCodeMessage = await phone.textContent('#pairMsg');
  await phone.fill('#code', code);
  await phone.click('#pairBtn');
  await phone.waitForURL(phoneOrigin + '/', { timeout: 5000 });
  await sleep(1200);
  out.phoneDeviceName = (await (await fetch(`http://127.0.0.1:${LOCAL}/api/devices`)).json()).devices.map((d) => d.name);

  // The phone talks to Lei.
  await phone.fill('#say', 'hello from my phone');
  await phone.press('#say', 'Enter');
  await sleep(2500);
  out.phoneReply = await phone.$$eval('.msg', (els) => els.at(-1)?.innerText);
  await phone.screenshot({ path: path.join(DIR, 'pair-phone-chat.png') });

  // The Mac removes the phone; the phone is sent back to pairing on its next request.
  await mac.click('#setBtn').catch(() => {});
  await mac.reload();
  await sleep(800);
  await mac.click('#setBtn');
  await sleep(600);
  out.macListBefore = await mac.$$eval('#deviceList li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  await mac.click('#deviceList li button');
  await sleep(600);
  out.macListAfter = await mac.$$eval('#deviceList li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  await phone.fill('#say', 'are you still there?');
  await phone.press('#say', 'Enter');
  await phone.waitForURL(/pair\.html/, { timeout: 5000 }).catch(() => {});
  out.phoneAfterRemoval = new URL(phone.url()).pathname;
  out.audit = fs.readFileSync(path.join(DIR, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
  out.errs = errs;
  console.log(JSON.stringify(out, null, 2));
  await b.close();
  srv.kill();
  fake.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
