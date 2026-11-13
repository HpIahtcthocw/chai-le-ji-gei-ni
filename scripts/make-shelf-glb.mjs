// 离线生成房间/展架 GLB。
// 引擎没有 BoxGeometry/PlaneGeometry 这样的几何体工厂，所以几何在 Node 里生成，
// 页面照常走 loadGLTF——与台灯完全相同的加载路径。
// 用法：node scripts/make-shelf-glb.mjs public/room/shelf.glb
import { Document, NodeIO } from '@gltf-transform/core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] || 'public/room/shelf.glb';

const doc = new Document();
const buffer = doc.createBuffer();

const mat = doc
  .createMaterial('shelf')
  .setBaseColorFactor([0.74, 0.76, 0.8, 1])
  .setMetallicFactor(0.05)
  .setRoughnessFactor(0.65)
  .setDoubleSided(true);

const scene = doc.createScene('room');

/** 一个长方体：6 个面 × 2 三角 = 36 顶点，带逐面法线 */
function addBox(size, center, name) {
  const [sx, sy, sz] = size;
  const [cx, cy, cz] = center;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;

  // 每个面：4 个角 + 法线
  const faces = [
    { n: [0, 0, -1], c: [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]] },
    { n: [0, 0, 1], c: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, -1, 0], c: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { n: [0, 1, 0], c: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [-1, 0, 0], c: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { n: [1, 0, 0], c: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
  ];

  const positions = [];
  const normals = [];
  for (const f of faces) {
    const [a, b, c, d] = f.c;
    // 两个三角形：a-b-c 与 a-c-d
    for (const v of [a, b, c, a, c, d]) {
      positions.push(v[0] + cx, v[1] + cy, v[2] + cz);
      normals.push(...f.n);
    }
  }

  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer),
    )
    .setMaterial(mat);

  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh);
  scene.addChild(node);
}

// 地面
addBox([2.0, 0.02, 2.0], [0, -0.01, 0], 'floor');
// 三层展板（x 轴长、y 轴薄）
addBox([1.2, 0.03, 0.34], [0, 0.36, 0], 'board-1');
addBox([1.2, 0.03, 0.34], [0, 0.76, 0], 'board-2');
addBox([1.2, 0.03, 0.34], [0, 1.16, 0], 'board-3');
// 背板与两侧立板
addBox([1.2, 1.2, 0.02], [0, 0.6, -0.17], 'back');
addBox([0.02, 1.2, 0.34], [-0.6, 0.6, 0], 'side-l');
addBox([0.02, 1.2, 0.34], [0.6, 0.6, 0], 'side-r');

mkdirSync(dirname(out), { recursive: true });
const io = new NodeIO();
const bytes = await io.writeBinary(doc);
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(bytes));
console.log(`${out}: ${(bytes.byteLength / 1024).toFixed(1)} KB, ${doc.getRoot().listNodes().length} 个节点`);
