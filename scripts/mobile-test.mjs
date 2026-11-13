// 手机端验证：iPhone 尺寸 + 真实触摸事件（CDP Input.dispatchTouchEvent），
// 跑完整局，重点看底部抽屉和触摸拖拽。
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const meta = JSON.parse(readFileSync('public/items/lamp/meta.json', 'utf8'));
const PARTS = meta.parts;
const report = { steps: [], errors: [], ok: false, scoreAtEnd: null };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--touch-events=enabled'],
});

const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  // 软件渲染下 deviceScaleFactor 2 会把进程压崩，用 1 先验证布局与触摸链路
  deviceScaleFactor: 1,
  hasTouch: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(`console: ${m.text()}`);
});

const cdp = await context.newCDPSession(page);
const game = () => page.evaluate('window.__GAME__ ? { ...window.__GAME__ } : null');
const waitPhase = (phase, timeout = 30000) =>
  page.waitForFunction(`window.__GAME__ && window.__GAME__.phase === "${phase}"`, null, { timeout });

const touch = (type, x, y) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });

async function dragActivePart() {
  const g = await game();
  if (!g?.activeFrom || !g?.activeTo) throw new Error(`第 ${g?.activeIndex} 块没有可拖的位置`);
  const from = g.activeFrom;
  const to = g.activeTo;
  await touch('touchStart', from.x, from.y);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(20);
  }
  await touch('touchEnd', 0, 0);
  return { from, to };
}

await page.goto(`${BASE}/item/lamp`, { waitUntil: 'load', timeout: 90000 });
await waitPhase('playing', 60000);
report.steps.push({ step: 'loaded', game: await game() });

// 第 1 块：拖上去 → 应弹底部抽屉。先验触摸链路，链路不通再退回鼠标并记录证据
await dragActivePart();
let touchOk = false;
try {
  await waitPhase('ask', 9000);
  touchOk = true;
} catch {
  const g = await game();
  report.steps.push({ step: 'touch drag failed', game: { phase: g.phase, diag: g.diag } });
  const from = g.activeFrom;
  const to = g.activeTo;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await waitPhase('ask');
}
report.touchOk = touchOk;
await page.waitForTimeout(200);
await page.screenshot({ path: '.tmp/mobile-quiz.png' });
report.steps.push({ step: 'part1 → ask', game: await game() });

await page.locator('main button').nth(PARTS[0].answerIndex).click();
await page.waitForTimeout(300);

for (let i = 1; i < PARTS.length; i++) {
  try {
    await page.waitForFunction(`window.__GAME__.activeIndex === ${i} && window.__GAME__.phase === "playing"`, null, {
      timeout: 25000,
    });
    if (i === 3) {
      await page.waitForTimeout(200);
      await page.screenshot({ path: '.tmp/mobile-mid.png' });
    }
    await dragActivePart();
    await page.waitForTimeout(420);
    const g = await game();
    if (g.phase === 'ask') throw new Error(`第 ${i + 1} 块不该再弹猜谜`);
    report.steps.push({ step: `part${i + 1} snapped`, game: { phase: g.phase, score: g.score } });
  } catch (err) {
    report.steps.push({ step: `part${i + 1} failed`, error: String(err.message), game: await game() });
    await page.screenshot({ path: '.tmp/mobile-fail.png' });
    writeFileSync('.tmp/mobile-report.json', JSON.stringify(report, null, 2), 'utf8');
    throw err;
  }
}

await waitPhase('finished', 30000);
const end = await game();
report.scoreAtEnd = end.score;
await page.waitForTimeout(2400);
await page.screenshot({ path: '.tmp/mobile-finished.png' });

const stlHref = await page.locator('a[download]').getAttribute('href').catch(() => null);
report.stlHref = stlHref;
report.ok = end.phase === 'finished' && end.score === 100 && stlHref === '/items/lamp/export.stl';
if (!report.ok) report.errors.push(`终局不符: ${JSON.stringify(end)} · stl=${stlHref}`);

await browser.close();
writeFileSync('.tmp/mobile-report.json', JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ok: report.ok, scoreAtEnd: report.scoreAtEnd, stlHref, errors: report.errors }, null, 2));
if (!report.ok) process.exitCode = 1;
