// 把 GLB 里的贴图导出来，确认模型本来有没有颜色
import { NodeIO } from '@gltf-transform/core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const io = new NodeIO();
const doc = await io.readBinary(new Uint8Array(readFileSync(process.argv[2])));
const textures = doc.getRoot().listTextures();
mkdirSync('.tmp', { recursive: true });
textures.forEach((t, i) => {
  const ext = t.getMimeType() === 'image/png' ? 'png' : 'jpg';
  const out = `.tmp/texture-${i}.${ext}`;
  writeFileSync(out, t.getImage());
  console.log(`${out} · ${t.getMimeType()} · ${(t.getImage().byteLength / 1024 / 1024).toFixed(2)} MB`);
});
