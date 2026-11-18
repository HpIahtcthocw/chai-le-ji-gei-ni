import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'E:/gitproject/chai-le-ji-gei-ni/.tmp';
const CODE = 'eyJhIjoiZ2VubXdrcHQzbXU4bzZoYiIsInMiOiLoh6rmtYsiLCJ0IjoxNzk0OTIxODc3NzE0fQ';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 140));
});

await page.goto(`http://localhost:3100/p/${CODE}`, { waitUntil: 'load' });
await page.waitForTimeout(4200);

const r = await page.evaluate(() => {
  const hurt = window.__PROTO_HURT__ ? window.__PROTO_HURT__(2) : 'no-hook';
  window.__PROTO_NOTE__ && window.__PROTO_NOTE__();
  return hurt;
});
console.log('damage:', r);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/note-worn.png` });

const text = await page.evaluate(() => {
  const body = document.querySelector('.lp-note-body');
  const worn = document.querySelector('.lp-note-worn');
  const btn = document.querySelector('.lp-note-worn button');
  return {
    body: body ? body.textContent : null,
    worn: worn ? worn.textContent.replace(/\s+/g, ' ') : null,
    hasButton: !!btn,
  };
});
console.log(JSON.stringify(text));
console.log('errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none');
await browser.close();
