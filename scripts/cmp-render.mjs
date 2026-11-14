// 单独看 /p/<code> 与 /item/<id> 的渲染差异
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

for (const [name, url] of [
  ['item', 'http://localhost:3100/item/lamp'],
  ['recv', 'http://localhost:3100/p/lamp'],
]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 120)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.click('[data-action="unpack"]').catch(() => {});
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const g = window.__GAME__;
    const hosts = Array.from(document.querySelectorAll('canvas')).map((c) => ({ w: c.clientWidth, h: c.clientHeight }));
    return { phase: g?.phase ?? null, score: g?.score ?? null, hosts };
  });
  await page.screenshot({ path: `.tmp/cmp-${name}.png` });
  console.log(name, JSON.stringify(info), 'errs=', errs.length, errs.slice(0, 2).join(' | '));
  await page.close();
}

await browser.close();
