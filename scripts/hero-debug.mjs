import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto('http://localhost:3100/show', { waitUntil: 'load' });
await page.waitForTimeout(9000);

const info = await page.evaluate(() => {
  const host = document.querySelector('.hero-canvas');
  const canvases = Array.from(document.querySelectorAll('canvas'));
  return window.__HERO__;
  return {
    hostW: host?.clientWidth,
    hostH: host?.clientHeight,
    hostHtml: host?.innerHTML.slice(0, 300),
    canvases: canvases.map((c) => ({ w: c.clientWidth, h: c.clientHeight, id: c.id, style: c.getAttribute('style') })),
  };
});
console.log(JSON.stringify({ size: info?.size, center: info?.center, radius: info?.radius, dist: info?.dist }, null, 2));

await browser.close();
