import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3100';
const code = process.argv[2];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/p/${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(8000);
const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim()));
console.log('buttons:', JSON.stringify(buttons));
const fired = await page.evaluate(() => {
  const api = window.__PROTO_API__;
  if (!api) return false;
  api.openSpread();
  return true;
});
if (fired) {
  const frames = [140, 320, 520, 760, 1100, 1600];
  let prev = 0;
  for (const [i, ms] of frames.entries()) {
    await page.waitForTimeout(ms - prev);
    prev = ms;
    await page.screenshot({ path: `.tmp/burst-${i + 1}.png` });
  }
  console.log('spread done');
} else { console.log('no api');
}
await browser.close();
