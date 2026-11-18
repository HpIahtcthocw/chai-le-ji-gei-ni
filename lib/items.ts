import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import manifest from './items-manifest.json';

export type ItemPart = {
  partId: string;
  label?: string;
  /** 旧版三选一题留下的字段：现在页面只认 partId / label */
  options?: string[];
  answerIndex?: number;
};

export type ItemMeta = {
  id: string;
  name: string;
  riddle: string;
  story: string;
  /** 寄件人说"最旧的一块"是哪件：答案是物件自己的事，不靠拆到最后一块暗示 */
  oldest?: string;
  /** 为什么最旧，一句话，跟着答案一起给人看 */
  oldestWhy?: string;
  partCount: number;
  parts: ItemPart[];
  /** 生成这件东西的那张原图，装盒页和纸条旁都用它 */
  sourceImage?: string;
  /** 首页展品：门口那件先被拆的东西 */
  featured?: boolean;
};

const ITEMS_DIR = path.join(process.cwd(), 'public', 'items');

// 只接受形如 lamp / _lab5 的目录名，挡住路径穿越
const isValidId = (id: string) => /^[a-z0-9_-]+$/i.test(id);

export async function listItemIds(): Promise<string[]> {
  // 构建时生成的清单（线上 serverless 读不到 public/items 目录）
  const baked = Object.keys(manifest as Record<string, ItemMeta>);
  if (baked.length) return baked.sort();
  try {
    const entries = await readdir(ITEMS_DIR, { withFileTypes: true });
    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue;
      try {
        await readFile(path.join(ITEMS_DIR, entry.name, 'meta.json'));
        ids.push(entry.name);
      } catch {
        // 没有 meta.json 的目录不算一件可玩的物品（比如测试件）
      }
    }
    return ids.sort();
  } catch {
    return [];
  }
}

export async function getItem(id: string): Promise<ItemMeta | null> {
  if (!isValidId(id)) return null;
  const bakedItem = (manifest as Record<string, ItemMeta>)[id];
  if (bakedItem) return bakedItem;
  try {
    const raw = await readFile(path.join(ITEMS_DIR, id, 'meta.json'), 'utf8');
    return JSON.parse(raw) as ItemMeta;
  } catch {
    return null;
  }
}
