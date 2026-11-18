/**
 * 线上部署时没有可读的 public/items 目录（serverless 只带被打包的文件），
 * 所以在构建前把各件的 meta.json 收成一份清单，随代码一起打进包。
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ITEMS = join(ROOT, 'public', 'items');
const OUT = join(ROOT, 'lib', 'items-manifest.json');

const manifest = {};
if (existsSync(ITEMS)) {
  for (const entry of readdirSync(ITEMS, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z0-9_-]+$/i.test(entry.name)) continue;
    const metaPath = join(ITEMS, entry.name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    manifest[entry.name] = JSON.parse(readFileSync(metaPath, 'utf8'));
  }
}

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`items-manifest: ${Object.keys(manifest).length} 件`, Object.keys(manifest).join(' / '));
