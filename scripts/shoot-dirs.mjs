import { chromium } from 'playwright-core';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = 'file:///E:/gitproject/chai-le-ji-gei-ni/design-demos';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const i of [1, 2, 3]) {
  await page.goto(`${base}/dir-${i}.html`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `E:/gitproject/chai-le-ji-gei-ni/.tmp/dir-${i}.png` });
}
console.log('shots ok');
await browser.close();
