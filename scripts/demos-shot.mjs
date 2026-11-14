// 三个设计方向的截图：用于让用户在一屏里比较三种视觉方向。
// 用法：node scripts/demos-shot.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const demos = [
  { file: 'design-demos/A-快递单.html', out: '.tmp/demo-A.png' },
  { file: 'design-demos/B-暗房.html', out: '.tmp/demo-B.png' },
  { file: 'design-demos/C-装配图纸.html', out: '.tmp/demo-C.png' },
  { file: 'design-demos/D-无名件.html', out: '.tmp/demo-D.png' },
  { file: 'design-demos/E-竖排满幅.html', out: '.tmp/demo-E.png' },
];

mkdirSync('.tmp', { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});

for (const demo of demos) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto(pathToFileURL(resolve(demo.file)).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: demo.out });
  console.log(`${demo.file} -> ${demo.out}  errors=${errors.length}`);
  if (errors.length) console.log(errors.join('\n'));
  await page.close();
}

await browser.close();
