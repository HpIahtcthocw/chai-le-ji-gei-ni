// 逐节点包围盒分析：用来判断拆分产物里每块是不是"意义的零件"，以及世界坐标轴朝向。
// 用法：node scripts/analyze-parts.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/analyze-parts.mjs <file.glb>');
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(path);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];

const parts = [];
root.listNodes().forEach((node, index) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  let prims = 0;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (!pos) continue;
    prims += 1;
    vertices += pos.getCount();
    const mn = pos.getMin([]);
    const mx = pos.getMax([]);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], mn[a]);
      max[a] = Math.max(max[a], mx[a]);
    }
  }
  const size = [0, 1, 2].map((a) => max[a] - min[a]);
  const center = [0, 1, 2].map((a) => (max[a] + min[a]) / 2);
  parts.push({
    index,
    name: node.getName() || `part-${index}`,
    vertices,
    prims,
    min: min.map((v) => Number(v.toFixed(3))),
    max: max.map((v) => Number(v.toFixed(3))),
    size: size.map((v) => Number(v.toFixed(3))),
    center: center.map((v) => Number(v.toFixed(3))),
    // 薄边方向：最小的一维通常是板/盖的厚度方向
    flatAxis: size.indexOf(Math.min(...size)),
  });
});

const overall = parts.reduce(
  (acc, p) => ({
    min: acc.min.map((v, i) => Math.min(v, p.min[i])),
    max: acc.max.map((v, i) => Math.max(v, p.max[i])),
  }),
  { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
);
const totalSize = overall.max.map((v, i) => Number((v - overall.min[i]).toFixed(3)));
const center = overall.max.map((v, i) => Number(((v + overall.min[i]) / 2).toFixed(3)));
const longestAxis = totalSize.indexOf(Math.max(...totalSize));

const outPath = process.argv[3];
const payload = JSON.stringify(
  {
    file: path,
    sceneNodes: scene ? scene.listChildren().map((n) => n.getName() || '(unnamed)') : [],
    partCount: parts.length,
    overall: { min: overall.min.map((v) => Number(v.toFixed(3))), max: overall.max.map((v) => Number(v.toFixed(3))) },
    totalSize,
    center,
    longestAxis,
    // glTF 规范是 Y 轴向上；最长轴 = 1 说明是直立物体，= 2 则说明几何是 Z-up
    upAxisGuess: longestAxis === 1 ? 'Y-up (glTF 标准)' : longestAxis === 2 ? 'Z-up (引擎习惯)' : 'X 轴最长，无法判断',
    parts: parts.sort((a, b) => b.vertices - a.vertices),
  },
  null,
  2,
);

if (outPath) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, payload, 'utf8');
  console.log(`written ${outPath} · ${parts.length} parts · ${payload.length} chars`);
} else {
  console.log(payload);
}
