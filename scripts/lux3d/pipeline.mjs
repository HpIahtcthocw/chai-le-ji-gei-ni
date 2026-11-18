// Lux3D 资产链路：生成 3D -> 立刻用官方临时 URL 做部件拆分 -> 全部落盘到 public/items/<id>/
// 用法：
//   node --env-file=.env.local scripts/lux3d/pipeline.mjs --id lamp --prompt "..." [--image ./x.jpg]
// 断点：每步把任务号和 URL 写进 public/items/<id>/pipeline.json，重跑会跳过已完成步骤。
import { createLux3dClient } from '@manycore/aholo-sdk-lux3d';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const apiKey = process.env.AHOLO_API_KEY;
if (!apiKey) {
  console.error('缺少 AHOLO_API_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const id = getArg('id');
const prompt = getArg('prompt');
const imagePath = getArg('image');
if (!id) {
  console.error('缺少 --id');
  process.exit(1);
}

const itemDir = resolve(process.cwd(), 'public/items', id);
mkdirSync(itemDir, { recursive: true });
const statePath = resolve(itemDir, 'pipeline.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');

const lux3d = createLux3dClient({ apiKey, region: process.env.AHOLO_REGION || 'cn' });
const WAIT = { intervalMs: 5000, timeoutMs: 20 * 60 * 1000 };

const download = async (url, dest) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.byteLength;
};

const pickGlbUrl = (outputs) => {
  const list = (outputs || []).map((o) => o?.content).filter((c) => typeof c === 'string');
  return list.find((c) => c.includes('.glb')) || null;
};

const pickStlUrl = (outputs) => {
  const list = (outputs || []).map((o) => o?.content).filter((c) => typeof c === 'string' && c !== 'NOT_REQUESTED');
  return list.find((c) => c.includes('.stl')) || null;
};

// ---- 1. 生成 3D（文生体或图生体） ----
if (!state.generate) {
  if (!prompt && !imagePath) {
    console.error('首次运行需要 --prompt 或 --image');
    process.exit(1);
  }
  if (imagePath) {
    const sourceImage = resolve(process.cwd(), imagePath);
    state.generate = { kind: 'img-to-3d', file: sourceImage };
    save();
    state.generate.taskId = await lux3d.imgTo3d.createFromFile(sourceImage, {
      version: 'G1',
      faceCount: 200000,
      outputFormat: ['glb', 'zip'],
      enablePbr: true,
      aiPredictSize: true,
    });
  } else {
    state.generate = { kind: 'text-to-3d', prompt };
    save();
    state.generate.taskId = await lux3d.textTo3d.create({
      prompt,
      version: 'G1-Turbo',
      style: 'photorealistic',
      faceCount: 200000,
      outputFormat: ['glb'],
      enablePbr: true,
    });
  }
  save();
  console.log(`[1/3] 生成任务已创建 taskId=${state.generate.taskId}`);
} else {
  console.log(`[1/3] 复用生成任务 taskId=${state.generate.taskId}`);
}

if (!state.generateUrl) {
  const result = await lux3d.tasks.waitFor(state.generate.taskId, WAIT);
  const url = pickGlbUrl(result.outputs);
  if (!url) throw new Error(`生成任务无 GLB 输出: ${JSON.stringify(result.outputs)}`);
  state.generateUrl = url;
  state.generateStatus = result.status;
  save();
  console.log(`[1/3] 生成完成，GLB: ${url.split('?')[0]}`);
}

const sourceSize = await download(state.generateUrl, resolve(itemDir, 'source.glb'));
console.log(`[1/3] source.glb 已落盘 ${(sourceSize / 1024 / 1024).toFixed(2)} MB`);

// ---- 2. 部件拆分（必须用官方临时 URL，落盘文件不能回传） ----
if (!state.split) {
  state.split = { taskId: await lux3d.partSplit.create({ glbUrl: state.generateUrl }) };
  save();
  console.log(`[2/3] 拆分任务已创建 taskId=${state.split.taskId}`);
} else {
  console.log(`[2/3] 复用拆分任务 taskId=${state.split.taskId}`);
}

if (!state.splitUrl) {
  const result = await lux3d.tasks.waitFor(state.split.taskId, WAIT);
  const url = pickGlbUrl(result.outputs);
  if (!url) throw new Error(`拆分任务无 GLB 输出: ${JSON.stringify(result.outputs)}`);
  state.splitUrl = url;
  state.splitStatus = result.status;
  save();
  console.log(`[2/3] 拆分完成，GLB: ${url.split('?')[0]}`);
}

const splitSize = await download(state.splitUrl, resolve(itemDir, 'model.glb'));
console.log(`[2/3] model.glb 已落盘 ${(splitSize / 1024 / 1024).toFixed(2)} MB`);

// ---- 3. 多格式导出（产出玩家最终下载的 STL） ----
// 默认用「生成产物」而非拆分产物：玩家下载的是拼好的整件物体，拆分 GLB 只是游戏用的中间态。
// 产物顺序固定为 zip/glb/usdz/objZip/fbxZip/stl/3mf，未请求的返回 NOT_REQUESTED，所以按后缀匹配。
const exportFrom = getArg('export-from') || 'source';
// 只做游戏用的示例件时，STL 导出那一次任务是纯浪费：给个开关跳过它
const skipExport = args.includes('--skip-export');

if (skipExport) {
  console.log('[3/3] 跳过 STL 导出（--skip-export）');
  console.log(
    JSON.stringify(
      { generate: state.generate, split: state.split, splitUrl: state.splitUrl },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (state.exportFailed) {
  // 上次失败过，清掉任务号重试，避免断点续跑时死循环
  delete state.export;
  delete state.stlUrl;
  delete state.exportFailed;
  save();
}

if (!state.export) {
  const modelUrl = exportFrom === 'split' ? state.splitUrl : state.generateUrl;
  state.export = { from: exportFrom, modelUrl, taskId: await lux3d.multiFormatExport.create({ modelUrl, outputFormat: ['stl'] }) };
  save();
  console.log(`[3/3] 导出任务已创建 taskId=${state.export.taskId}（来源: ${exportFrom}）`);
}

if (!state.stlUrl) {
  try {
    const result = await lux3d.tasks.waitFor(state.export.taskId, WAIT);
    const url = pickStlUrl(result.outputs);
    if (!url) throw new Error(`导出任务无 STL 输出: ${JSON.stringify(result.outputs)}`);
    state.stlUrl = url;
    save();
    console.log(`[3/3] STL: ${url.split('?')[0]}`);
  } catch (err) {
    state.exportFailed = true;
    save();
    throw err;
  }
}

const stlSize = await download(state.stlUrl, resolve(itemDir, 'export.stl'));
console.log(`[3/3] export.stl 已落盘 ${(stlSize / 1024 / 1024).toFixed(2)} MB`);

console.log(`完成。物品目录：${itemDir}`);
console.log(JSON.stringify(state, null, 2));
