// 生成一个用于管道验证的合成 GLB：5 个独立零件节点 + 1 段关节动画。
// 目的不是替代 Lux3D 产物，而是先把 aholo-viewer 的"多节点 / 逐节点变换 / 动画播放"三条链路验证清楚。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'public/items/_lab5/model.glb');

/** 造一个以原点为中心的盒体：24 顶点 / 36 索引，法线按面写。 */
function boxGeometry(w, h, d) {
  const half = [w / 2, h / 2, d / 2];
  const faces = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },   // +Z
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },  // -Z
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },   // +X
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },   // -X
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },   // +Y
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },   // -Y
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  const axisOf = (vec) => vec.findIndex((c) => c !== 0);
  for (const f of faces) {
    const nAxis = axisOf(f.n);
    const uAxis = axisOf(f.u);
    const vAxis = axisOf(f.v);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const base = positions.length / 3;
    for (const [s, t] of corners) {
      const p = [0, 0, 0];
      p[nAxis] = f.n[nAxis] * half[nAxis];
      p[uAxis] = f.u[uAxis] * s * half[uAxis];
      p[vAxis] = f.v[vAxis] * t * half[vAxis];
      positions.push(p[0], p[1], p[2]);
      normals.push(f.n[0], f.n[1], f.n[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

const PARTS = [
  { name: 'base', dims: [0.9, 0.12, 0.9], at: [0, 0, 0], color: [0.30, 0.32, 0.36, 1] },
  { name: 'pole', dims: [0.10, 0.80, 0.10], at: [0, 0.46, 0], color: [0.55, 0.57, 0.62, 1] },
  { name: 'arm', dims: [0.62, 0.09, 0.10], at: [0.34, 0.86, 0], color: [0.86, 0.72, 0.28, 1] },
  { name: 'shade', dims: [0.42, 0.30, 0.42], at: [0.70, 1.02, 0], color: [0.90, 0.90, 0.86, 1] },
  { name: 'bulb', dims: [0.14, 0.14, 0.14], at: [0.70, 0.86, 0], color: [1.0, 0.84, 0.35, 1] },
];

const bin = [];
let offset = 0;
const bufferViews = [];
const accessors = [];

function pushView(buf, target) {
  const start = offset;
  bufferViews.push({ buffer: 0, byteOffset: start, byteLength: buf.byteLength, target });
  bin.push(buf);
  offset += buf.byteLength;
  return bufferViews.length - 1;
}

function addAccessor(bufferView, componentType, count, type, extra = {}) {
  accessors.push({ bufferView, componentType, count, type, ...extra });
  return accessors.length - 1;
}

const meshes = [];
for (const part of PARTS) {
  const g = boxGeometry(...part.dims);
  const pos = new Float32Array(g.positions);
  const nrm = new Float32Array(g.normals);
  const idx = new Uint16Array(g.indices);

  const pv = pushView(pos, 34962);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], pos[i + a]);
      max[a] = Math.max(max[a], pos[i + a]);
    }
  }
  const posAcc = addAccessor(pv, 5126, pos.length / 3, 'VEC3', { min, max });
  const nrmView = pushView(nrm, 34962);
  const nrmAcc = addAccessor(nrmView, 5126, nrm.length / 3, 'VEC3');
  const idxView = pushView(idx, 34963);
  const idxAcc = addAccessor(idxView, 5123, idx.length, 'SCALAR');

  meshes.push({
    name: `${part.name}-mesh`,
    primitives: [{ attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: PARTS.indexOf(part) }],
  });
}

const materials = PARTS.map((p) => ({
  name: `${p.name}-mat`,
  pbrMetallicRoughness: { baseColorFactor: p.color, metallicFactor: 0.15, roughnessFactor: 0.75 },
  doubleSided: true,
}));

// 关节动画：arm 节点绕 Z 轴 0° -> 45°，0~1.2s
const times = new Float32Array([0, 0.6, 1.2]);
const tv = pushView(times, null);
const tAcc = addAccessor(tv, 5126, 3, 'SCALAR', { min: [0], max: [1.2] });
const q = (deg) => {
  const r = (deg * Math.PI) / 180 / 2;
  return [0, 0, Math.sin(r), Math.cos(r)];
};
const rots = new Float32Array([...q(0), ...q(22.5), ...q(45)]);
const rv = pushView(rots, null);
const rAcc = addAccessor(rv, 5126, 3, 'VEC4');

// 对齐到 4 字节
while (offset % 4 !== 0) {
  bin.push(new Uint8Array([0]));
  offset += 1;
}

const gltf = {
  asset: { version: '2.0', generator: 'chai-le-ji-gei-ni lab asset' },
  scene: 0,
  scenes: [{ nodes: PARTS.map((_, i) => i) }],
  nodes: PARTS.map((p, i) => ({ name: p.name, mesh: i, translation: p.at })),
  meshes,
  materials,
  animations: [
    {
      name: 'arm-lift',
      channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }],
      samplers: [{ input: tAcc, output: rAcc, interpolation: 'LINEAR' }],
    },
  ],
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

const glbBuffer = Buffer.concat(
  bin.map((b) => Buffer.from(new Uint8Array(b.buffer, b.byteOffset, b.byteLength))),
);
const json = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPadded = Buffer.concat([glbBuffer, Buffer.alloc((4 - (glbBuffer.length % 4)) % 4, 0)]);
const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonPadded.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binPadded.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded]));
console.log(`wrote ${OUT} (${total} bytes), parts=${PARTS.length}`);
