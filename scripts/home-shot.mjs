import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const out = 'E:/gitproject/chai-le-ji-gei-ni/.tmp';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://localhost:3100/', { waitUntil: 'load' });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/home-1.png` });

// 试着把左边那条灯臂往外拉
const box = await page.evaluate(() => {
  const el = document.querySelector('.lp-stage');
  return el ? el.getBoundingClientRect().toJSON() : null;
});
const cx = box ? box.x + box.width * 0.60 : 700;
const cy = box ? box.y + box.height * 0.33 : 420;

await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 12; i += 1) {
  await page.mouse.move(cx + i * 26, cy - i * 8, { steps: 1 });
  await page.waitForTimeout(60);
}
await page.mouse.up();
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/home-2.png` });

console.log('errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none');
await browser.close();
