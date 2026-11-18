import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'E:/gitproject/chai-le-ji-gei-ni/.tmp';
const CODE = 'eyJhIjoiZ2VubXdrcHQzbXU4bzZoYiIsInMiOiLoh6rmtYsiLCJ0IjoxNzk0OTIxODc3NzE0fQ';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 120));
});

const shot = async (url, file, after) => {
  await page.goto(`http://localhost:3100${url}`, { waitUntil: 'load' });
  await page.waitForTimeout(3800);
  if (after) await after();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(file, 'ok');
};

// 拆包页：直接跳到纸条那一屏，验原图浮出 + 回一句
await shot(`/p/${CODE}`, 'loop-note.png', async () => {
  await page.evaluate(() => window.__PROTO_NOTE__ && window.__PROTO_NOTE__());
});

// 回信页
await shot(`/r/${CODE}`, 'loop-reply.png');

// 装盒页（假文案已删）
await shot(`/s/${CODE}`, 'loop-share.png');

// 进度页（旧任务没有 pipeline，先看是否不炸）
await shot('/job/jmwkpt3mu8o6hb', 'loop-job.png');

console.log('errors:', errors.length ? errors.slice(0, 5).join(' | ') : 'none');
await browser.close();
