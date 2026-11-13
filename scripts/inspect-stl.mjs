// 校验 STL：区分二进制/ASCII，报告三角面数与包围盒，确认导出产物不是空壳。
// 用法：node scripts/inspect-stl.mjs public/items/lamp/export.stl
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/inspect-stl.mjs <file.stl>');
  process.exit(1);
}

const buf = readFileSync(path);
const head = buf.subarray(0, 5).toString('ascii');
if (head.trimStart().toLowerCase().startsWith('solid')) {
  // ASCII STL 也可能以 solid 开头，用 "facet normal" 出现次数确认
  const text = buf.toString('utf8');
  const facets = (text.match(/facet\s+normal/gi) || []).length;
  console.log(JSON.stringify({ file: path, format: 'ascii', triangles: facets }, null, 2));
} else {
  const count = buf.readUInt32LE(80);
  const expected = 84 + count * 50;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let offset = 84;
  for (let i = 0; i < count; i++) {
    offset += 12; // 法向量
    for (let v = 0; v < 3; v++) {
      for (let a = 0; a < 3; a++) {
        const val = buf.readFloatLE(offset + a * 4);
        if (val < min[a]) min[a] = val;
        if (val > max[a]) max[a] = val;
      }
      offset += 12;
    }
    offset += 2; // 属性字节
  }
  console.log(
    JSON.stringify(
      {
        file: path,
        format: 'binary',
        sizeMB: Number((buf.length / 1024 / 1024).toFixed(2)),
        triangles: count,
        byteLengthMatches: buf.length === expected,
        bbox: {
          min: min.map((v) => Number(v.toFixed(3))),
          max: max.map((v) => Number(v.toFixed(3))),
        },
      },
      null,
      2,
    ),
  );
}
