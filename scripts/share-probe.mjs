import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

const res = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const body = await fetch('http://localhost:3100/api/parcel', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ assetId: 'lamp', sender: '阿七', image: 'https://holo-cos.aholo3d.cn/resource/platform/temp/2026/11/14/NL347UAKTKX72AABAAAAABQ8.jpg' }),
});
const json = await body.json();
console.log('code', json.code);

await res.goto(`http://localhost:3100/s/${json.code}`, { waitUntil: 'load' });
await res.waitForTimeout(2500);
const dom = await res.evaluate(() => {
  const fig = document.querySelector('.share-photo');
  const img = fig?.querySelector('img');
  const panel = document.querySelector('.share-panel');
  return {
    hasFig: !!fig,
    imgSrc: img?.getAttribute('src')?.slice(0, 90) ?? null,
    natural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
    figBox: fig ? fig.getBoundingClientRect().toJSON() : null,
    panelBox: panel ? panel.getBoundingClientRect().toJSON() : null,
    display: fig ? getComputedStyle(fig).display : null,
  };
});
console.log(JSON.stringify(dom, null, 2));
await res.screenshot({ path: '.tmp/share-probe.png' });
await browser.close();
