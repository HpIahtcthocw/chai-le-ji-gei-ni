import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'E:/gitproject/chai-le-ji-gei-ni/.tmp';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 140));
});

await page.goto('http://localhost:3100/', { waitUntil: 'load' });
await page.waitForTimeout(4200);

// 真正把一块拉到手上的位置，并弹出三选一
const pulled = await page.evaluate(() => (window.__PROTO_PULL__ ? window.__PROTO_PULL__() : 'no-hook'));
console.log('pull:', pulled);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/quiz-1.png` });

// 点“台灯”：这件东西就是台灯，应该是正确答案
const result = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll('.lp-guess-opts button')];
  const target = btns.find((b) => b.textContent && b.textContent.trim() === '台灯') || btns[0];
  if (!target) return { clicked: 'none' };
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  const counter = document.querySelector('.lp-count');
  return { clicked: target.textContent, counter: counter ? counter.textContent.replace(/\s+/g, ' ') : 'no-counter', panel: !!document.querySelector('.lp-guess') };
});
console.log('answer:', JSON.stringify(result));
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/quiz-2.png` });

console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
await browser.close();
