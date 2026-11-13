import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:3100';
const exe = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: exe, headless: true });

const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desktop.goto(`${BASE}/`, { waitUntil: 'load' });
await desktop.waitForTimeout(1100);
await desktop.screenshot({ path: '.tmp/ui-home.png' });
await desktop.click('a[href="/item/lamp"]');
await desktop.waitForTimeout(260);
await desktop.screenshot({ path: '.tmp/ui-loading.png' });
await desktop.close();

const mobile = await browser.newPage({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});
await mobile.goto(`${BASE}/`, { waitUntil: 'load' });
await mobile.waitForTimeout(1100);
await mobile.screenshot({ path: '.tmp/ui-home-mobile.png' });
await mobile.close();

console.log('shots ok');
await browser.close();
