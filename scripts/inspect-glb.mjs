// 校验 GLB 结构：节点、网格、动画、包围盒。用于确认"拆分结果是否是可逐节点操作的独立零件"。
import { NodeIO } from '@gltf-transform/core';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/inspect-glb.mjs <file.glb>');
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(path);
const root = doc.getRoot();

const report = {
  file: path,
  scenesCount: root.listScenes().length,
  nodeCount: root.listNodes().length,
  meshCount: root.listMeshes().length,
  materialCount: root.listMaterials().length,
  textureCount: root.listTextures().length,
  animationCount: root.listAnimations().length,
  animations: root.listAnimations().map((a) => ({
    name: a.getName(),
    channels: a.listChannels().length,
    targets: a.listChannels().map((c) => `${c.getTargetNode()?.getName()}:${c.getTargetPath()}`),
  })),
  nodes: root.listNodes().map((n) => {
    const mesh = n.getMesh();
    const prims = mesh ? mesh.listPrimitives().length : 0;
    const verts = mesh
      ? mesh.listPrimitives().reduce((s, p) => s + (p.getAttribute('POSITION')?.getCount() ?? 0), 0)
      : 0;
    return {
      name: n.getName() || '(unnamed)',
      hasMesh: Boolean(mesh),
      primitives: prims,
      vertices: verts,
      children: n.listChildren().map((c) => c.getName() || '(unnamed)'),
      translation: n.getTranslation(),
      scale: n.getScale(),
    };
  }),
};

console.log(JSON.stringify(report, null, 2));
