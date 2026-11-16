// 截图：/p/<code> 收件人第一眼、/s/<code> 装盒页
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

await page.goto(`${BASE}/s/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(900);
await page.screenshot({ path: '.tmp/flow-share.png' });

await page.goto(`${BASE}/p/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__PROTO_API__ && window.__PROTO__', null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: '.tmp/flow-receive.png' });

console.log(JSON.stringify({ errors, code }, null, 1));
await browser.close();
