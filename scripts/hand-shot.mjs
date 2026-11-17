// 手势面板单帧
import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const code = Buffer.from(JSON.stringify({ a: 'lamp', s: '小周', t: 1794636822364 }), 'utf8').toString('base64url');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/p/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__PROTO_API__ && window.__PROTO__', null, { timeout: 120000 });
await page.click('.lp-hands');
await page.waitForTimeout(4000);
await page.screenshot({ path: '.tmp/hands-panel.png' });
console.log(await page.textContent('.hi-status').catch(() => 'none'));
await browser.close();
