// 90 秒 Demo 录制：预热 → 首页 → 装盒页 → 拆七块 → 摊开 → 四档 → 手势
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const OUT = '.tmp/video/demo';
const code = Buffer.from(JSON.stringify({ a: 'lamp', s: '小周', t: 1794636822364 }), 'utf8').toString('base64url');
const args = [
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args });

// 预热：先把两条路由编译好、把模型读进内存，正式录的时候第一帧就是成片
{
  const warm = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await warm.newPage();
  await p.goto(`${BASE}/p/${code}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction('window.__PROTO_API__ && window.__PROTO__', null, { timeout: 120000 });
  await p.waitForTimeout(1500);
  await p.goto(`${BASE}/s/${code}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await warm.close();
}

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await wait(3600);
for (const ratio of [0.46, 1]) {
  await page.evaluate(async (r) => {
    const from = window.scrollY;
    const target = Math.min(document.body.scrollHeight - window.innerHeight, document.body.scrollHeight * r);
    const dur = 2400;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    await new Promise((res) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        window.scrollTo(0, from + (target - from) * ease(t));
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }, ratio);
  await wait(2600);
}

await page.goto(`${BASE}/s/${code}`, { waitUntil: 'domcontentloaded' });
await wait(4000);

await page.goto(`${BASE}/p/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__PROTO_API__ && window.__PROTO__', null, { timeout: 90000 });
await wait(1800);

const state = () => page.evaluate('window.__PROTO_API__.state()');
const pick = (x, y) => page.evaluate(`window.__PROTO_API__.pick(${x}, ${y})`);

// 采样点少而准：中心 → 一圈 8 个方向、4 个半径
async function grabPoint(part) {
  const offsets = [[0, 0]];
  for (const r of [8, 20, 34, 52]) for (let a = 0; a < 8; a++) offsets.push([Math.cos(a * 0.785) * r, Math.sin(a * 0.785) * r]);
  for (const [ox, oy] of offsets) {
    const x = Math.round(part.x + ox);
    const y = Math.round(part.y + oy);
    if ((await pick(x, y)) === part.index) return { x, y };
  }
  return null;
}

for (let round = 0; round < 12; round++) {
  await wait(520);
  const s = await state();
  if ((await page.evaluate('window.__PROTO_API__.phase()')) === 'done') break;
  const cand = s.find((p) => !p.removed && p.free.length > 0);
  if (!cand) break;
  const p = await grabPoint(cand);
  if (!p) continue;
  const dir = cand.free[0];
  const len = Math.hypot(dir.dx, dir.dy) || 1;
  await page.mouse.move(p.x, p.y);
  await wait(120);
  await page.mouse.down();
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(p.x + (dir.dx / len) * 220 * (i / steps), p.y + (dir.dy / len) * 220 * (i / steps));
    await wait(18);
  }
  await page.mouse.up();
}

await wait(1600);
const go = await page.$('.lp-note .lp-cta');
if (go) {
  await go.click();
  await page.waitForFunction('window.__PROTO_API__.spread() >= 0.99', null, { timeout: 20000 });
  await wait(2400);
}

for (const n of [1, 2, 3, 4]) {
  await page.click(`.lp-finish button:nth-child(${n})`);
  await wait(n === 4 ? 3000 : 1200);
}

await page.click('.lp-hands');
await wait(3400);
await page.click('.hi-close');
await wait(2600);

await ctx.close();
await browser.close();
console.log('done');
