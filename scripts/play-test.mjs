// 无头跑一整局：真实鼠标拖零件 → 吸合 → 猜谜 → 计分 → 拼完。
// 用法：node scripts/play-test.mjs（需要 npm run dev 已在 3100 端口跑着）
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const meta = JSON.parse(readFileSync('public/items/lamp/meta.json', 'utf8'));
const PARTS = meta.parts;

mkdirSync('.tmp', { recursive: true });
const report = { steps: [], errors: [], ok: false, scoreAtEnd: null };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(`console: ${m.text()}`);
});

const game = () => page.evaluate('window.__GAME__ ? { ...window.__GAME__ } : null');
const waitPhase = (phase, timeout = 20000) =>
  page.waitForFunction(`window.__GAME__ && window.__GAME__.phase === "${phase}"`, null, { timeout });

/** 把当前零件从待拼位拖到它的原位 */
async function dragActivePart() {
  const g = await game();
  if (!g?.activeFrom || !g?.activeTo) throw new Error(`第 ${g?.activeIndex} 块没有可拖的位置`);
  const from = g.activeFrom;
  const to = g.activeTo;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  return { from, to };
}

/** 点猜谜卡片里第 index 个选项 */
async function answer(index) {
  await page.locator('main button').nth(index).click();
}

await page.goto(`${BASE}/item/lamp`, { waitUntil: 'load', timeout: 90000 });
await waitPhase('playing', 60000);
report.steps.push({ step: 'loaded', game: await game() });

// 第 1 块：故意猜错，验证扣分与再问一次
await dragActivePart();
await waitPhase('ask');
report.steps.push({ step: 'part1 drag→ask', game: await game() });
const wrongIndex = (PARTS[0].answerIndex + 1) % 3;
await answer(wrongIndex);
await page.waitForTimeout(300);
report.steps.push({ step: 'part1 wrong answer', game: await game() });

// 等第 2 块到货
await page.waitForFunction('window.__GAME__.phase === "playing" && window.__GAME__.activeIndex === 1', null, {
  timeout: 20000,
});

// 第 2 块：猜对，之后不再问
await dragActivePart();
await waitPhase('ask');
report.steps.push({ step: 'part2 drag→ask', game: await game() });
await answer(PARTS[1].answerIndex);
await page.waitForTimeout(300);
report.steps.push({ step: 'part2 correct answer', game: await game() });

// 剩下的零件直接拼完，应该不再弹猜谜
for (let i = 2; i < PARTS.length; i++) {
  await page.waitForFunction(`window.__GAME__.activeIndex === ${i} && window.__GAME__.phase === "playing"`, null, {
    timeout: 20000,
  });
  if (i === 3) {
    // 拼到一半的样子：已合体几块 + 手上这块 + 落点指示
    await page.waitForTimeout(200);
    await page.screenshot({ path: '.tmp/play-mid.png' });
  }
  await dragActivePart();
  await page.waitForTimeout(420);
  const g = await game();
  if (g.phase === 'ask') throw new Error(`第 ${i + 1} 块不该再弹猜谜`);
  report.steps.push({ step: `part${i + 1} snapped`, game: g });
}

await waitPhase('finished', 30000);
const end = await game();
report.scoreAtEnd = end.score;
await page.waitForTimeout(900);
await page.screenshot({ path: '.tmp/play-finished.png' });

const stlHref = await page.locator('a[download]').getAttribute('href').catch(() => null);
report.stlHref = stlHref;
report.ok = end.phase === 'finished' && end.score === 86 && stlHref === '/items/lamp/export.stl';
if (!report.ok) report.errors.push(`终局状态不符: ${JSON.stringify(end)} · stl=${stlHref}`);

// 这局结束后再截一张"进行中"的样子：重新开一页，拼两块停下
const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page2.goto(`${BASE}/item/lamp`, { waitUntil: 'load', timeout: 90000 });
await page2.waitForFunction('window.__GAME__ && window.__GAME__.phase === "playing"', null, { timeout: 60000 });
await page2.screenshot({ path: '.tmp/play-arrive.png' });

await browser.close();
writeFileSync('.tmp/play-report.json', JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ok: report.ok, scoreAtEnd: report.scoreAtEnd, stlHref, errors: report.errors }, null, 2));
if (!report.ok) process.exitCode = 1;
