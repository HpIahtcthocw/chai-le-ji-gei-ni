import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type ItemPart = {
  partId: string;
  label?: string;
  options: string[];
  answerIndex: number;
};

export type ItemMeta = {
  id: string;
  name: string;
  riddle: string;
  story: string;
  partCount: number;
  parts: ItemPart[];
  /** 生成这件东西的那张原图，装盒页和纸条旁都用它 */
  sourceImage?: string;
};

const ITEMS_DIR = path.join(process.cwd(), 'public', 'items');

// 只接受形如 lamp / _lab5 的目录名，挡住路径穿越
const isValidId = (id: string) => /^[a-z0-9_-]+$/i.test(id);

export async function listItemIds(): Promise<string[]> {
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
  try {
    const raw = await readFile(path.join(ITEMS_DIR, id, 'meta.json'), 'utf8');
    return JSON.parse(raw) as ItemMeta;
  } catch {
    return null;
  }
}
