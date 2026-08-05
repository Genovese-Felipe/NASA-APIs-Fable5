/* ── Cosmoscope e2e smoke test ──────────────────────────────────────
   Serves the repo over HTTP, drives headless Chromium through the
   real user journey: boot → welcome → render (non-black pixels) →
   language switch → NASA panels (offline fallback path) → keyboard
   selection → still capture → video recording. Also captures the
   screenshots used in the README when SHOTS=1.
   Run: node tests/e2e/smoke.mjs                                    */

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const SHOTS = process.env.SHOTS === '1';
const shotsDir = join(root, 'docs', 'screenshots');
if (SHOTS) await mkdir(shotsDir, { recursive: true });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  acceptDownloads: true,
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

await page.goto(base + '/', { waitUntil: 'load' });

/* welcome gate */
await page.waitForSelector('#welcome-quiet', { timeout: 10000 });
check('welcome overlay shown', true);
await page.click('#welcome-quiet');
await page.waitForTimeout(4200);        /* opening camera flight */

/* WebGL2 render sanity: canvas must not be black */
const render = await page.evaluate(() => {
  const gl = document.getElementById('scene');
  const c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const ctx = c.getContext('2d');
  ctx.drawImage(gl, 0, 0, 160, 90);
  const d = ctx.getImageData(0, 0, 160, 90).data;
  let lit = 0, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] + d[i + 1] + d[i + 2];
    if (l > 24) lit++;
    if (l > max) max = l;
  }
  return { litFrac: lit / (d.length / 4), max, w: gl.width, h: gl.height };
});
check('scene renders non-black pixels', render.litFrac > 0.02 && render.max > 150,
  `lit=${(render.litFrac * 100).toFixed(1)}% max=${render.max} @${render.w}x${render.h}`);

/* HUD state */
check('sim date shown', (await page.textContent('#sim-date')).trim().length > 4);
check('selected body is Earth', (await page.textContent('#sel-name')).includes('Earth'));

/* language switch → Portuguese */
await page.selectOption('#lang', 'pt');
await page.waitForTimeout(300);
const firstBody = await page.textContent('#body-list .body-item');
check('language switch localizes body list (pt: Sol)', firstBody.includes('Sol'), firstBody.trim());
const tagline = await page.textContent('.brand-sub');
check('static labels localized', tagline.includes('NASA'));
await page.selectOption('#lang', 'en');

/* keyboard selection: 6 → Saturn */
await page.click('#scene', { position: { x: 640, y: 200 } });
await page.keyboard.press('6');
await page.waitForTimeout(2200);
check('keyboard selects Saturn', (await page.textContent('#sel-name')).includes('Saturn'));

/* NASA panels — sandboxed env has no NASA reachability, so this
   exercises the offline-fallback path end to end. Fallback fires
   after the client's fetch timeout (12 s), so wait generously. */
const waitPanel = async (sel) => {
  try {
    await page.waitForFunction((s) => {
      const el = document.querySelector(s);
      return el && !el.querySelector('.spinner') && el.textContent.trim().length > 30;
    }, sel, { timeout: 25000 });
    return (await page.textContent(sel)).trim();
  } catch { return ''; }
};

await page.click('.rail-btn[data-tab="apod"]');
const apodText = await waitPanel('#apod-content');
check('APOD panel shows content (live or sample fallback)', apodText.length > 40);

await page.click('.rail-btn[data-tab="asteroids"]');
await waitPanel('#neo-content');
const neoCards = await page.locator('#neo-content .api-card').count();
check('NeoWs panel lists asteroids', neoCards >= 1, `${neoCards} cards`);

await page.click('.rail-btn[data-tab="weather"]');
await page.click('#donki-load');
const donkiText = await waitPanel('#donki-content');
check('DONKI panel shows flare/CME sections', donkiText.length > 20);

/* still capture: full HD PNG download */
await page.click('.rail-btn[data-tab="capture"]');
await page.selectOption('#shot-res', '1920');
const dlPromise = page.waitForEvent('download', { timeout: 30000 });
await page.click('#btn-shot');
try {
  const dl = await dlPromise;
  const path = await dl.path();
  const { statSync } = await import('node:fs');
  const size = statSync(path).size;
  check('1080p still export downloads', size > 30000, `${dl.suggestedFilename()} ${(size / 1024).toFixed(0)} KB`);
} catch (e) {
  check('1080p still export downloads', false, String(e).slice(0, 120));
}

/* video recording (short) */
const recSupported = await page.evaluate(() =>
  typeof MediaRecorder !== 'undefined' &&
  ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].some((m) => MediaRecorder.isTypeSupported(m)));
if (recSupported) {
  const recDl = page.waitForEvent('download', { timeout: 30000 });
  await page.click('#btn-rec');
  await page.waitForTimeout(2600);
  await page.click('#btn-rec');
  try {
    const dl = await recDl;
    const path = await dl.path();
    const { statSync } = await import('node:fs');
    const size = statSync(path).size;
    check('video recording downloads', size > 10000, `${dl.suggestedFilename()} ${(size / 1024).toFixed(0)} KB`);
  } catch (e) {
    check('video recording downloads', false, String(e).slice(0, 120));
  }
} else {
  console.log('  – video recording unsupported in this headless build (skipped)');
}

/* settings interactions */
await page.click('.rail-btn[data-tab="settings"]');
await page.click('#quality-seg button[data-q="low"]');
await page.waitForTimeout(600);
const renderLow = await page.evaluate(() => {
  const gl = document.getElementById('scene');
  const c = document.createElement('canvas');
  c.width = 64; c.height = 36;
  c.getContext('2d').drawImage(gl, 0, 0, 64, 36);
  const d = c.getContext('2d').getImageData(0, 0, 64, 36).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
  return lit / (d.length / 4);
});
check('low-quality preset still renders', renderLow > 0.02, `lit=${(renderLow * 100).toFixed(1)}%`);
await page.click('#quality-seg button[data-q="high"]');

/* true-scale mode swap */
const isNoise = (e) => /net::|Failed to fetch|ERR_|load resource|WebGL.*performance|GroupMarkerNotSet/i.test(e);
const errsBefore = pageErrors.filter((e) => !isNoise(e)).length;
await page.click('#scale-seg button[data-s="true"]');
await page.waitForTimeout(400);
check('true-scale mode survives', pageErrors.filter((e) => !isNoise(e)).length === errsBefore);
await page.click('#scale-seg button[data-s="showcase"]');

/* ── README screenshots ── */
if (SHOTS) {
  await page.click('#panel-close');
  await page.keyboard.press('6');            /* Saturn hero */
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(shotsDir, 'hero-saturn.png') });

  await page.keyboard.press('3');            /* Earth */
  await page.waitForTimeout(2400);
  await page.click('.rail-btn[data-tab="explore"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shotsDir, 'explore-earth.png') });

  await page.click('.rail-btn[data-tab="capture"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shotsDir, 'capture-panel.png') });

  await page.click('#panel-close');
  await page.keyboard.press('0');            /* the Sun */
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(shotsDir, 'sun.png') });

  /* mobile layout */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(shotsDir, 'mobile.png') });
  console.log('  📸 screenshots saved to docs/screenshots/');
}

/* page errors collected along the way */
const realErrors = pageErrors.filter((e) => !isNoise(e));
check('no unexpected page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nAll smoke checks passed ✅' : `\n${failures} check(s) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
