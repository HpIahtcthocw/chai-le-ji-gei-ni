// 无头浏览器跑 /lab 实验页，把 window.__LAB__ 的结论取回来。
// 复用本机已装的 Chrome（不下载浏览器），WebGL 走 SwiftShader 软件渲染。
// 用法：node scripts/verify-lab.mjs [item1 item2 ...]
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.LAB_BASE || 'http://localhost:3100';
const items = process.argv.slice(2).length ? process.argv.slice(2) : ['_lab5', 'lamp'];

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});

const results = {};
for (const item of items) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleLines = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') consoleLines.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`));

  const url = `${BASE}/lab?item=${item}`;
  process.stdout.write(`[${item}] 打开 ${url}\n`);
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });

  try {
    await page.waitForFunction('window.__LAB__ !== undefined', null, { timeout: 90000 });
    const lab = await page.evaluate('window.__LAB__');
    results[item] = { lab, console: consoleLines };
    await page.screenshot({ path: `.tmp/lab-${item}.png` });
  } catch (err) {
    const fallback = await page.evaluate('window.__LAB__ ?? null');
    results[item] = { error: String(err?.message || err), partial: fallback, console: consoleLines };
    await page.screenshot({ path: `.tmp/lab-${item}-failed.png` });
  }
  await page.close();
}

await browser.close();
const payload = JSON.stringify(results, null, 2);
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync('.tmp', { recursive: true });
writeFileSync('.tmp/lab-result.json', payload, 'utf8');
console.log(`written .tmp/lab-result.json (${payload.length} chars)`);
