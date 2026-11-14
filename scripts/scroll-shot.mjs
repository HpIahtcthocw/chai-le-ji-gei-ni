// 滚动驱动首屏的录屏与关键帧：动效只有看视频才判得准。
// 用法：node scripts/scroll-shot.mjs
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
await page.waitForTimeout(1200);

const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
const gotoP = async (p) => {
  await page.evaluate(({ p, maxScroll }) => {
    window.scrollTo({ top: maxScroll * p, behavior: 'instant' });
  }, { p, maxScroll });
  await page.waitForTimeout(1400);
};

for (const p of [0, 0.12, 0.25, 0.4, 0.6, 0.78, 0.92, 1]) {
  await gotoP(p);
  await page.screenshot({ path: `.tmp/scroll-${String(Math.round(p * 100)).padStart(3, '0')}.png` });
}

// 回顶部，再演一遍平滑滚动（给评审看的动效样片）
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(1200);
const steps = 40;
for (let i = 1; i <= steps; i += 1) {
  await page.evaluate(({ i, steps, maxScroll }) => {
    window.scrollTo({ top: (maxScroll * i) / steps, behavior: 'instant' });
  }, { i, steps, maxScroll });
  await page.waitForTimeout(140);
}
await page.waitForTimeout(1500);

console.log(`errors=${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5).join('\n'));

const video = page.video();
await context.close();
await browser.close();
if (video) {
  const path = await video.path();
  console.log(`video=${path}`);
}
