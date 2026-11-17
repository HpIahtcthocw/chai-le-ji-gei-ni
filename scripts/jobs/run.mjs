// 一个包裹的生成进程：照片 → 3D → 拆件 → 落盘 → 出码
// 由 /api/jobs 以独立进程拉起，状态写回 .data/jobs/<id>.json，页面轮询读取
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const id = process.argv[2];
if (!id) {
  console.error('缺少 job id');
  process.exit(1);
}

const jobPath = resolve(process.cwd(), '.data/jobs', `${id}.json`);
if (!existsSync(jobPath)) {
  console.error('任务文件不存在');
  process.exit(1);
}

const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const save = () => writeFileSync(jobPath, JSON.stringify(job, null, 2), 'utf8');
const mark = (key, state, note) => {
  const step = job.steps.find((s) => s.key === key);
  if (step) {
    step.state = state;
    if (note) step.note = note;
  }
  if (state === 'run' && job.status !== 'failed') job.status = 'running';
  save();
};
const fail = (err) => {
  job.status = 'failed';
  job.error = String((err && err.message) || err).slice(0, 300);
  const running = job.steps.find((s) => s.state === 'run');
  if (running) running.state = 'fail';
  save();
  console.error(job.error);
  process.exit(1);
};

const apiKey = process.env.AHOLO_API_KEY;
if (!apiKey) fail(new Error('缺少 AHOLO_API_KEY'));

const lux3d = createLux3dClient({ apiKey, region: process.env.AHOLO_REGION || 'cn' });
const WAIT = { intervalMs: 5000, timeoutMs: 20 * 60 * 1000 };

const glbUrlOf = (outputs) =>
  (outputs || [])
    .map((o) => o?.content)
    .filter((c) => typeof c === 'string')
    .find((c) => c.includes('.glb')) || null;

const download = async (url, dest) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.byteLength;
};

// GLB 的 JSON 块里有节点树，数一下带 mesh 的节点就是件数
const countParts = (path) => {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  return (json.nodes || []).filter((n) => n.mesh !== undefined).length || (json.meshes || []).length || 0;
};

const codeOf = (itemId, sender) => {
  const payload = { a: itemId, s: sender || undefined, i: job.image, t: Date.now() };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

try {
  mark('intake', 'done', '照片已入库');
  mark('understand', 'run');

  const taskId = await lux3d.imgTo3d.create({
    img: job.image,
    version: 'G1',
    faceCount: 200000,
    outputFormat: ['glb'],
    enablePbr: true,
    aiPredictSize: true,
  });
  mark('understand', 'done', `任务 ${taskId}`);
  mark('shape', 'run');

  const result = await lux3d.tasks.waitFor(taskId, WAIT);
  const glbUrl = glbUrlOf(result.outputs);
  if (!glbUrl) throw new Error(`生成任务没有 GLB 输出: ${JSON.stringify(result.outputs).slice(0, 200)}`);
  mark('shape', 'done', '形状已生成');
  mark('split', 'run');

  const splitId = await lux3d.partSplit.create({ glbUrl });
  const splitResult = await lux3d.tasks.waitFor(splitId, WAIT);
  const splitUrl = glbUrlOf(splitResult.outputs);
  if (!splitUrl) throw new Error(`拆分任务没有 GLB 输出: ${JSON.stringify(splitResult.outputs).slice(0, 200)}`);

  const itemId = `gen${id.slice(1)}`;
  const itemDir = resolve(process.cwd(), 'public/items', itemId);
  mkdirSync(itemDir, { recursive: true });
  const modelPath = resolve(itemDir, 'model.glb');
  const bytes = await download(splitUrl, modelPath);
  mark('split', 'done', `${(bytes / 1024 / 1024).toFixed(1)} MB`);

  // 生成物的材质常常太亮，压一遍，和专业资产的观感对齐
  try {
    execFileSync(process.execPath, ['scripts/retune-material.mjs', `public/items/${itemId}/model.glb`], { stdio: 'ignore' });
  } catch {
    /* 调材质失败不影响出件 */
  }

  mark('pack', 'run');
  const partCount = countParts(modelPath);
  const meta = {
    id: itemId,
    name: job.name || '无名件',
    riddle: '它每天最后一个关掉自己。',
    story: `寄件人留言：${job.sentence}`,
    partCount,
    parts: [],
  };
  writeFileSync(resolve(itemDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  writeFileSync(
    resolve(itemDir, 'pipeline.json'),
    JSON.stringify({ generate: { kind: 'img-to-3d', image: job.image, taskId }, generateUrl: glbUrl, split: { taskId: splitId }, splitUrl }, null, 2),
    'utf8',
  );

  job.itemId = itemId;
  job.code = codeOf(itemId, job.sender);
  job.partCount = partCount;
  mark('pack', 'done', `${partCount} 件`);
  mark('ready', 'done');
  job.status = 'done';
  save();
  console.log('done', job.code);
} catch (err) {
  fail(err);
}
