import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SHOT_BASE || 'http://localhost:3100';
mkdirSync('.tmp', { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}\n${e.stack}`));
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));

await page.goto(`${BASE}/item/lamp`, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(12000);
const state = await page.evaluate('window.__GAME__ ? { ...window.__GAME__ } : null');
await page.screenshot({ path: '.tmp/probe.png' });
console.log(JSON.stringify({ state, logs }, null, 2));
await browser.close();
