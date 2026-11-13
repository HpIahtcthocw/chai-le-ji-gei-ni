// 重调 GLB 材质：Lux3D 产出的材质 metallic=1 / roughness=1，
// 金属没有漫反射，纯点光源下就只剩高光，看起来像白膜。
// 这里把金属度压到塑料区间，让白色表面有明暗过渡。
// 用法：node scripts/retune-material.mjs <glb> <metallic> <roughness>
import { NodeIO } from '@gltf-transform/core';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , file, metallicArg, roughnessArg] = process.argv;
const metallic = Number(metallicArg ?? 0.15);
const roughness = Number(roughnessArg ?? 0.55);

const io = new NodeIO();
const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
const materials = doc.getRoot().listMaterials();

for (const m of materials) {
  m.setMetallicFactor(metallic);
  m.setRoughnessFactor(roughness);
}

const out = await io.writeBinary(doc);
writeFileSync(file, Buffer.from(out));
console.log(`${file}: ${materials.length} 个材质 → metallic=${metallic}, roughness=${roughness}`);
