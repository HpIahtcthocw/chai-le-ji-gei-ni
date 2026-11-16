// Tripo v3 生成一件东西：图片 → GLB，直接落到 public/items/<id>/
// 用法：
//   node --env-file=.env.local scripts/tripo/pipeline.mjs --input <https 图片地址> --id <物品 id> [--parts]
// --parts 走 generate_parts（不贴图，出可编辑分件），用来替代 Aholo 的 part-split 省额度
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEY = process.env.TRIPO_API_KEY;
const BASE = 'https://openapi.tripo3d.com/v3';
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (!KEY) {
  console.error('缺少 TRIPO_API_KEY：把 TRIPO_API_KEY=... 写进 .env.local，再用 node --env-file=.env.local 跑。');
  process.exit(1);
}

const input = value('input');
const id = value('id');
const model = value('model', 'v3.1-20260211');
if (!input || !id) {
  console.error('缺参数：--input <https 图片地址> --id <物品 id>');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

/** 分件模式吃不到贴图；要贴图就别要分件，这是 Tripo 的硬约束 */
const body = flag('parts')
  ? { input, model, generate_parts: true, texture: false, pbr: false }
  : { input, model, texture: true, pbr: true, texture_quality: 'detailed' };

const created = await fetch(`${BASE}/generation/image-to-model`, {
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});
const createdJson = await created.json();
if (createdJson.code !== 0) {
  console.error('建任务失败：', JSON.stringify(createdJson));
  process.exit(1);
}
const taskId = createdJson.data.task_id;
console.log(`task ${taskId} · ${flag('parts') ? '分件模式' : '带贴图'}`);

let task = null;
for (let i = 0; i < 300; i += 1) {
  const res = await fetch(`${BASE}/tasks/${taskId}`, { headers });
  const json = await res.json();
  task = json.data;
  console.log(`${task.status} ${task.progress ?? 0}%`);
  if (task.status === 'success') break;
  if (['failed', 'cancelled', 'expired', 'banned'].includes(task.status)) {
    console.error('生成失败：', task.error_code, task.error_message);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
if (!task || task.status !== 'success') {
  console.error('轮询超时');
  process.exit(1);
}

console.log(`消耗积分 ${task.credits_consumed ?? '未知'}`);

// 模型地址 5 分钟就失效，成功之后立刻下载
const dir = path.join(process.cwd(), 'public', 'items', id);
await mkdir(dir, { recursive: true });
const glb = await fetch(task.output.model_url);
if (!glb.ok) {
  console.error('下载失败：', glb.status);
  process.exit(1);
}
const buf = Buffer.from(await glb.arrayBuffer());
await writeFile(path.join(dir, flag('parts') ? 'parts-tripo.glb' : 'model.glb'), buf);
await writeFile(
  path.join(dir, 'tripo.json'),
  JSON.stringify({ taskId, input, model, parts: flag('parts'), output: task.output, credits: task.credits_consumed }, null, 2)
);

console.log(`落盘 public/items/${id}/${flag('parts') ? 'parts-tripo.glb' : 'model.glb'} · ${(buf.length / 1048576).toFixed(2)} MB`);
console.log('下一步：node scripts/inspect-materials.mjs public/items/' + id + '/' + (flag('parts') ? 'parts-tripo.glb' : 'model.glb') + ' 看是不是真拆成了多块');
