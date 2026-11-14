// 端到端：首页 → 寄件（真上传）→ 装盒出码 → 收件人拆包。
// 用法：node scripts/flow-test.mjs
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.FLOW_BASE || 'http://localhost:3100';
const UPLOAD = '.tmp/lamp-crop.png';

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
});

const report = { steps: [], ok: false };

const step = async (name, fn) => {
  const t = Date.now();
  try {
    const info = await fn();
    report.steps.push({ name, ms: Date.now() - t, info: info ?? null });
  } catch (err) {
    report.steps.push({ name, ms: Date.now() - t, error: String(err).slice(0, 300) });
    throw err;
  }
};

try {
  await step('首页', async () => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.screenshot({ path: '.tmp/flow-1-home.png' });
    return page.locator('.hero-title').innerText();
  });

  await step('进寄件页', async () => {
    await page.getByRole('link', { name: '我也要寄一件' }).click();
    await page.waitForURL('**/send', { timeout: 30000 });
    return page.url();
  });

  await step('上传照片', async () => {
    await page.setInputFiles('input[type=file]', UPLOAD);
    await page.waitForSelector('.send-status-text:has-text("已入库")', { timeout: 60000 });
    return page.locator('.send-url-value').innerText();
  });

  await step('装盒出码', async () => {
    await page.fill('.send-sign input', '阿七');
    await page.click('.send-next');
    await page.waitForURL('**/s/**', { timeout: 60000 });
    await page.waitForSelector('.share-qr svg', { timeout: 30000 });
    await page.screenshot({ path: '.tmp/flow-2-share.png' });
    return page.locator('.share-link code').innerText();
  });

  const shareUrl = page.url();

  await step('收件人视角', async () => {
    await page.click('.share-primary');
    await page.waitForURL('**/p/**', { timeout: 60000 });
    await page.waitForSelector('[data-action="unpack"]', { timeout: 60000 });
    await page.screenshot({ path: '.tmp/flow-3-parcel.png' });
    return page.url();
  });

  await step('拆包开玩', async () => {
    // ctrlRef 在模型下载完成后才挂上，太早点击会被吞掉
    await page.waitForFunction(() => window.__GAME__?.phase === 'sealed', null, { timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.click('[data-action="unpack"]');
    await page.waitForFunction(() => window.__GAME__?.phase !== 'sealed', null, { timeout: 40000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: '.tmp/flow-4-playing.png' });
    return page.evaluate(() => {
      const s = window.__GAME__;
      return s ? { phase: s.phase ?? null, score: s.score ?? null } : null;
    });
  });

  report.ok = true;
} catch (err) {
  report.failure = String(err).slice(0, 400);
}

report.errors = errors.slice(0, 8);
report.shareUrl = page.url();
writeFileSync('.tmp/flow-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
process.exit(report.ok ? 0 : 1);
