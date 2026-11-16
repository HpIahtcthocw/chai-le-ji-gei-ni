// 诊断：某块零件在屏幕上的投影中心能不能被拾取，以及它到底在画面哪里
// 用法：node scripts/probe-part.mjs 6
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
const target = Number(process.argv[2] ?? 6);

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${BASE}/proto`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction('window.__PROTO_API__ && window.__PROTO__', null, { timeout: 120000 });
await page.waitForTimeout(1200);

const s = await page.evaluate('window.__PROTO_API__.state()');
console.log(JSON.stringify(s, null, 1));

const p = s.find((q) => q.index === target);
console.log(`\ntarget ${target}: center=(${p.x},${p.y}) free=${p.free.length}`);
console.log('pick at center ->', await page.evaluate(`window.__PROTO_API__.pick(${p.x}, ${p.y})`));

// 在中心周围大面积扫描，看这块在屏幕上到底占没占像素
const hits = [];
for (let r = 0; r <= 200; r += 10) {
  for (let a = 0; a < 16; a++) {
    const x = Math.round(p.x + Math.cos(a * 0.3927) * r);
    const y = Math.round(p.y + Math.sin(a * 0.3927) * r);
    if (x < 0 || y < 0 || x > 1440 || y > 900) continue;
    const got = await page.evaluate(`window.__PROTO_API__.pick(${x}, ${y})`);
    if (got === target) hits.push([x, y]);
  }
  if (hits.length > 3) break;
}
console.log(`screen hits for ${target}:`, hits.slice(0, 6), hits.length ? '' : '(none within 200px)');

await page.screenshot({ path: `.tmp/proto/probe-${target}.png` });
await browser.close();
