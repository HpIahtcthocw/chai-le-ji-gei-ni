// 截图：给当前状态留证据，也用来检查页面在真浏览器里的样子。
// 用法：node scripts/shot.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';

const shots = [
  { url: '/', out: '.tmp/shot-home.png', waitMs: 800 },
  { url: '/item/lamp', out: '.tmp/shot-exploding.png', waitMs: 950 },
  {
    url: '/item/lamp',
    out: '.tmp/shot-exploded.png',
    waitMs: 300,
    stopAt: 'window.__SCENE__ && window.__SCENE__.phase === "exploded"',
  },
];

mkdirSync('.tmp', { recursive: true });
const log = [];
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}${shot.url}`, { waitUntil: 'load', timeout: 90000 });
  if (shot.stopAt) {
    await page.waitForFunction(shot.stopAt, null, { timeout: 30000 }).catch(() => errors.push('等待状态超时'));
  }
  await page.waitForTimeout(shot.waitMs);
  await page.screenshot({ path: shot.out, fullPage: false });

  const scene = await page.evaluate('window.__SCENE__ ?? null').catch(() => null);
  log.push({ out: shot.out, url: shot.url, scene, errors });
  console.log(`${shot.out} ← ${shot.url} · scene=${JSON.stringify(scene)}${errors.length ? ` · ${errors.join(' | ')}` : ''}`);
  await page.close();
}

await browser.close();
const { writeFileSync } = await import('node:fs');
writeFileSync('.tmp/shot-log.json', JSON.stringify(log, null, 2), 'utf8');
console.log('written .tmp/shot-log.json');
