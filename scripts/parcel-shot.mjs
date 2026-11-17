import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const code = process.argv[2];
const prefix = process.argv[3] || '.tmp/parcel';
const drags = Number(process.argv[4] || 0);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}/p/${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${prefix}-open.png` });
const info = await page.evaluate(() => ({
  title: document.querySelector('.lp-title')?.textContent,
  sub: document.querySelector('.lp-sub')?.textContent,
  segs: document.querySelector('.lp-progress')?.textContent,
  tags: Array.from(document.querySelectorAll('.lp-tag')).map((e) => e.textContent),
  canvas: !!document.querySelector('canvas'),
}));
console.log(JSON.stringify({ info, errors }, null, 0));

for (let i = 0; i < drags; i += 1) {
  const before = await page.evaluate(() => document.querySelector('.lp-progress')?.textContent);
  const box = await page.locator('canvas').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.62);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 190, box.y + box.height * 0.62 + 120, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(1400);
  const after = await page.evaluate(() => document.querySelector('.lp-progress')?.textContent);
  console.log(`drag${i + 1}: ${before} -> ${after}`);
  await page.screenshot({ path: `${prefix}-drag${i + 1}.png` });
}
await browser.close();
