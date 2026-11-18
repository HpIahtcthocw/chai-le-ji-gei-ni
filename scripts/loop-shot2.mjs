import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'E:/gitproject/chai-le-ji-gei-ni/.tmp';
const CODE =
  'eyJhIjoiZ2VubXdrcHQzbXU4bzZoYiIsInMiOiLmlLbku7bkuroiLCJpIjoiaHR0cHM6Ly9ob2xvLWNvcy5haG9sbzNkLmNuL3Jlc291cmNlL3BsYXRmb3JtL3RlbXAvMjAyNi8xMS8xNy9OTDZGR1NBS1RMR0FNQUFCQUFBQUFDWTguanBnIiwidCI6MTc5NDk3MDYwOTA1NiwibSI6IuaLhuWujOS6huOAgueBr-i_mOWcqOaIkeahjOS4iu-8jOWPquaYr-Wug-eOsOWcqOefpemBk-iHquW3seaYr-S4g-Wdl-OAgiJ9';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120));
});

await page.goto(`http://localhost:3100/s/${CODE}`, { waitUntil: 'load' });
await page.waitForTimeout(3200);
await page.screenshot({ path: `${OUT}/loop-share2.png` });

await page.goto(`http://localhost:3100/p/${CODE}`, { waitUntil: 'load' });
await page.waitForTimeout(4200);
await page.evaluate(() => window.__PROTO_NOTE__ && window.__PROTO_NOTE__());
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/loop-note2.png` });

console.log('errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none');
await browser.close();
