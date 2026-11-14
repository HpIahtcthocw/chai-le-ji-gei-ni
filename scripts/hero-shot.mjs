// 首屏 3D 的录屏与关键帧：动效必须看视频才能判断。
// 用法：node scripts/hero-shot.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';

mkdirSync('.tmp', { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: '.tmp/video', size: { width: 1440, height: 900 } },
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: 'load', timeout: 90000 });
await page.waitForSelector('.hero-loading', { state: 'detached', timeout: 60000 }).catch(() => errors.push('加载态没有结束'));

const t0 = Date.now();
const shotAt = async (ms, out) => {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: out });
};

await shotAt(900, '.tmp/hero-idle.png');
await shotAt(3200, '.tmp/hero-exploded.png');
await shotAt(7300, '.tmp/hero-collapse.png');
await shotAt(10800, '.tmp/hero-lit.png');
await shotAt(14200, '.tmp/hero-loop.png');

console.log(`errors=${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));

const video = page.video();
await context.close();
await browser.close();
if (video) {
  const path = await video.path();
  console.log(`video=${path}`);
}
