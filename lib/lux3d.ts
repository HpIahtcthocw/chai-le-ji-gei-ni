import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';

/**
 * Lux3D 服务端入口。
 * 只在这里读密钥：客户端永远拿不到 AHOLO_API_KEY。
 */
export function lux3d() {
  const apiKey = process.env.AHOLO_API_KEY;
  if (!apiKey) return null;
  const region = process.env.AHOLO_REGION === 'com' ? 'com' : 'cn';
  return createLux3dClient({ apiKey, region });
}

type Output = { content?: string | null } | null | undefined;

/** 任务产物里挑出 GLB：输出顺序随服务端变，只认后缀 */
export function pickGlb(outputs: Output[] | undefined | null): string | null {
  const list = (outputs ?? [])
    .map((o) => (o && typeof o.content === 'string' ? o.content : null))
    .filter((c): c is string => Boolean(c));
  return list.find((c) => c.includes('.glb')) ?? null;
}

/** 只允许把这几个域的模型地址喂给拆件接口，避免被当成任意 URL 的跳板 */
export function isAllowedModelUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return /(^|\.)(kujiale\.com|aholo3d\.cn)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** 0 排队 / 1 跑着 / 3 成功 / 4 失败 / 6 取消 */
export const TASK_STATE = {
  pending: [0],
  running: [1],
  done: [3],
  failed: [4, 6],
} as const;

export function taskPhase(status: number | string | undefined): 'pending' | 'running' | 'done' | 'failed' {
  const n = Number(status);
  if (n === 3) return 'done';
  if (n === 4 || n === 6) return 'failed';
  if (n === 1) return 'running';
  return 'pending';
}
