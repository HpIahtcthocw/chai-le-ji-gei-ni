// 无头试玩「拆开才看得到」原型：先故意拉一块被挡住的，再按畅通方向逐块拆，直到取出留言、炸开、装回。
// 用法：node scripts/proto-test.mjs（需要 npm run dev 在 3000 端口跑着）
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3000';
mkdirSync('.tmp/proto', { recursive: true });
const report = { steps: [], errors: [] };

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && report.errors.push(`console: ${m.text()}`));

await page.goto(`${BASE}/proto`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__PROTO__ && window.__PROTO_API__', null, { timeout: 120000 });
await page.waitForTimeout(800);
report.analysis = await page.evaluate('window.__PROTO__');
await page.screenshot({ path: '.tmp/proto/00-start.png' });

const state = () => page.evaluate('window.__PROTO_API__.state()');
const pick = (x, y) => page.evaluate(`window.__PROTO_API__.pick(${x}, ${y})`);

/** 在零件投影中心附近找一个确实打中这块零件的点 */
async function grabPoint(part) {
  const offsets = [[0, 0]];
  // 细一点的螺旋采样：细长零件（电源线）在 8 方向 × 44px 的粗网格里会整块漏掉
  for (let r = 3; r <= 72; r += 3) for (let a = 0; a < 24; a++) offsets.push([Math.cos(a * 0.2618) * r, Math.sin(a * 0.2618) * r]);
  for (const [ox, oy] of offsets) {
    const x = Math.round(part.x + ox);
    const y = Math.round(part.y + oy);
    if ((await pick(x, y)) === part.index) return { x, y };
  }
  return null;
}

/** 用手势接口拉：捏住 → 移动 → 松开，和摄像头识别走同一条路 */
async function pullByHand(part, dir, px) {
  const p = await grabPoint(part);
  if (!p) return false;
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  const grabbed = await page.evaluate(`window.__PROTO_API__.hand.grab(${p.x}, ${p.y})`);
  for (let i = 1; i <= 14; i++) {
    await page.evaluate(`window.__PROTO_API__.hand.move(${p.x + (dir.dx / len) * px * (i / 14)}, ${p.y + (dir.dy / len) * px * (i / 14)})`);
    await page.waitForTimeout(16);
  }
  await page.evaluate('window.__PROTO_API__.hand.release()');
  return grabbed;
}

async function pull(part, dir, px, shot) {
  const p = await grabPoint(part);
  if (!p) return false;
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(p.x + (dir.dx / len) * px * (i / steps), p.y + (dir.dy / len) * px * (i / steps));
    await page.waitForTimeout(16);
    if (shot && i === 4) await page.screenshot({ path: shot });
  }
  await page.mouse.up();
  return true;
}

// 1. 故意拉一块被挡住的零件，看反馈
let s = await state();
const blocked = s.find((p) => !p.removed && p.free.length === 0 && p.index !== report.analysis.coreIndex);
if (blocked) {
  await pull(blocked, { dx: 1, dy: -1 }, 60, '.tmp/proto/01-blocked.png');
  const hint = await page.textContent('.lp-hint').catch(() => null);
  report.steps.push({ step: 'blocked-try', part: blocked.index, hint });
}

// 2. 逐块拆
for (let round = 0; round < 14; round++) {
  await page.waitForTimeout(700);
  s = await state();
  const done = await page.evaluate('window.__PROTO_API__.phase()');
  if (done === 'done') break;
  const candidate = s.find((p) => !p.removed && p.free.length > 0);
  if (!candidate) {
    report.steps.push({ step: 'stuck', round });
    break;
  }
  const dir = candidate.free[0];
  const ok = round === 0 ? await pullByHand(candidate, dir, 220) : await pull(candidate, dir, 220, round === 1 ? '.tmp/proto/02-pulling.png' : null);
  const after = await state();
  report.steps.push({ step: 'pull', round, part: candidate.index, dir, grabbed: ok, removed: after[candidate.index].removed });
  if (round === 2) await page.screenshot({ path: '.tmp/proto/03-midway.png' });
}

await page.waitForTimeout(900);
await page.screenshot({ path: '.tmp/proto/04-message.png' });
report.letter = await page.textContent('.lp-note').catch(() => null);

const spreadAt = () => page.evaluate('window.__PROTO_API__.spread()');
async function shotWhen(min, path) {
  for (let i = 0; i < 200; i++) {
    if ((await spreadAt()) >= min) break;
    await page.waitForTimeout(30);
  }
  await page.screenshot({ path });
}
const go = await page.$('.lp-note .lp-cta');
if (go) {
  await go.click();
  await shotWhen(0.25, '.tmp/proto/05a-blast.png');
  await shotWhen(0.62, '.tmp/proto/05b-sorting.png');
  await shotWhen(0.985, '.tmp/proto/05c-shelf.png');
  report.shelfText = await page.textContent('.lp-rule-bottom').catch(() => null);
  for (let i = 0; i < 20; i++) {
    await page.evaluate('window.__PROTO_API__.hand.spreadBy(-0.03)');
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(900);
  report.handSpreadClose = await spreadAt();
  await page.evaluate('window.__PROTO_API__.setSpread(1)');
  await shotWhen(0.985, '.tmp/proto/05c-shelf.png');
  await page.click('.lp-finish button:nth-child(3)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '.tmp/proto/05d-riso.png' });
  await page.click('.lp-finish button:nth-child(2)');
  await page.waitForTimeout(500);
  await page.screenshot({ path: '.tmp/proto/05e-raw.png' });
  await page.click('.lp-finish button:nth-child(1)');
  await page.click('.lp-rule-bottom .lp-cta');
  for (let i = 0; i < 200 && (await spreadAt()) > 0.01; i++) await page.waitForTimeout(30);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '.tmp/proto/06-reassembled.png' });
}

await page.click('.lp-hands');
for (let i = 0; i < 60; i++) {
  const t = await page.textContent('.hi-status').catch(() => null);
  report.handStatus = t;
  if (t && !t.startsWith('正在')) break;
  await page.waitForTimeout(500);
}
await page.screenshot({ path: '.tmp/proto/07-hands.png' });

writeFileSync('.tmp/proto/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();