// 线框态：整件 → 全部拆开 → 摊到货架
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const code = Buffer.from(JSON.stringify({ a: 'lamp', s: '小周', t: 1794636822364 }), 'utf8').toString('base64url');

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(`${BASE}/p/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__PROTO_API__ && window.__PROTO__', null, { timeout: 120000 });
await page.waitForTimeout(1200);

await page.click('.lp-finish button:nth-child(4)');
await page.waitForTimeout(3000);
await page.screenshot({ path: '.tmp/line-intact.png' });

const state = () => page.evaluate('window.__PROTO_API__.state()');
const pick = (x, y) => page.evaluate(`window.__PROTO_API__.pick(${x}, ${y})`);

async function grabPoint(part) {
  const offsets = [[0, 0]];
  for (let r = 3; r <= 72; r += 3) for (let a = 0; a < 24; a++) offsets.push([Math.cos(a * 0.2618) * r, Math.sin(a * 0.2618) * r]);
  for (const [ox, oy] of offsets) {
    const x = Math.round(part.x + ox);
    const y = Math.round(part.y + oy);
    if ((await pick(x, y)) === part.index) return { x, y };
  }
  return null;
}

async function pull(part, dir, px) {
  const p = await grabPoint(part);
  if (!p) return false;
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(p.x + (dir.dx / len) * px * (i / 14), p.y + (dir.dy / len) * px * (i / 14));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  return true;
}

for (let round = 0; round < 14; round++) {
  await page.waitForTimeout(700);
  const s = await state();
  if ((await page.evaluate('window.__PROTO_API__.phase()')) === 'done') break;
  const cand = s.find((p) => !p.removed && p.free.length > 0);
  if (!cand) break;
  await pull(cand, cand.free[0], 220);
}

await page.waitForTimeout(800);
await page.screenshot({ path: '.tmp/line-midway.png' });

const go = await page.$('.lp-note .lp-cta');
if (go) {
  await go.click();
  await page.waitForFunction('window.__PROTO_API__.spread() >= 0.99', null, { timeout: 20000 });
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: '.tmp/line-shelf.png' });

await page.click('.lp-finish button:nth-child(1)');
await page.waitForTimeout(2500);
await page.screenshot({ path: '.tmp/ink-restored.png' });

console.log(JSON.stringify({ errors }, null, 1));
await browser.close();
