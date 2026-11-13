// 看材质与贴图到底有没有：白膜的锅是模型本身白，还是贴图没被用上
import { NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'node:fs';

const io = new NodeIO();
const hex = (arr) => (arr ? arr.map((v) => Math.round(v * 255)).join(',') : '-');

for (const file of process.argv.slice(2)) {
  const doc = await io.readBinary(new Uint8Array(readFileSync(file)));
  const root = doc.getRoot();
  const materials = root.listMaterials();
  const textures = root.listTextures();
  console.log(`\n=== ${file} ===`);
  console.log(`materials=${materials.length} textures=${textures.length} images=${root.listTextures().length}`);
  for (const m of materials) {
    console.log(
      [
        `mat "${m.getName() || '(无名)'}"`,
        `baseColor=[${hex(m.getBaseColorFactor())}]`,
        `metallic=${m.getMetallicFactor().toFixed(2)}`,
        `roughness=${m.getRoughnessFactor().toFixed(2)}`,
        `baseColorTex=${m.getBaseColorTexture() ? 'YES' : 'no'}`,
        `emissiveTex=${m.getEmissiveTexture() ? 'YES' : 'no'}`,
        `normalTex=${m.getNormalTexture() ? 'YES' : 'no'}`,
        `alphaMode=${m.getAlphaMode()}`,
      ].join(' · '),
    );
  }
  for (const t of textures) {
    const img = t.getImage();
    console.log(`texture "${t.getName() || '(无名)'}" mime=${t.getMimeType()} bytes=${img ? img.byteLength : 0}`);
  }
  const meshes = root.listMeshes();
  const totalPrims = meshes.reduce((n, m) => n + m.listPrimitives().length, 0);
  console.log(`meshes=${meshes.length} primitives=${totalPrims}`);
}
