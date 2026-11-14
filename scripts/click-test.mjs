import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const exe =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(`error: ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));

await page.goto(`${BASE}/`, { waitUntil: 'load' });
const start = Date.now();
await page.click('a[href="/item/lamp"]');
let navigated = false;
try {
  await page.waitForURL('**/item/lamp', { timeout: 10000 });
  navigated = true;
} catch {}
const navMs = Date.now() - start;

let readyMs = null;
if (navigated) {
  try {
    await page.waitForFunction('window.__GAME__ && window.__GAME__.phase === "sealed"', null, { timeout: 30000 });
  await page.click('[data-action="unpack"]');
  await page.waitForFunction('window.__GAME__ && window.__GAME__.phase === "playing"', null, { timeout: 30000 });
    readyMs = Date.now() - start;
  } catch {}
}

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
await page.screenshot({ path: '.tmp/click-after.png' });
console.log(JSON.stringify({ navigated, navMs, readyMs, errors: logs, bodyText }, null, 2));
await browser.close();
