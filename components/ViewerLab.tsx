'use client';

import { useEffect, useRef, useState } from 'react';

type LabResult = {
  ok: boolean;
  error?: string;
  model?: { meshes: number; names: string[]; box: number[]; animations: number };
  perNodeMove?: { node: string; delta: number[]; othersMoved: number };
  clipPlayback?: { clip: string; before: number; after: number; changed: boolean };
  pick?: { at00: string | null; atCorner: string | null };
};

const ITEM_URL = '/items/_lab5/model.glb';

export default function ViewerLab() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<LabResult | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let raf = 0;
    let disposed = false;
    let viewer: any = null;
    let plugin: any = null;
    const say = (line: string) => setLines((prev) => [...prev, line]);

    const run = async () => {
      const A: any = await import('@manycore/aholo-viewer');
      const out: LabResult = { ok: false };

      // 1. 空场景
      const width = host.clientWidth || 800;
      const height = host.clientHeight || 600;
      viewer = A.createViewer('lab', host, { antialiasing: true });
      viewer.config.coordinateSystem.enabled.set(false);
      A.setViewerConfig(viewer, {
        pipeline: {
          Background: {
            background: {
              active: A.BackgroundMode.BasicBackground,
              basic: { color: new A.Color(0.055, 0.063, 0.078) },
            },
            ground: { enabled: false },
          },
          Splatting: { enabled: true },
          TAA: { enabled: false },
        },
      });
      const camera = new A.PerspectiveCamera(45, width / height, 0.05, 400);
      viewer.setCamera(camera);
      const scene = viewer.getScene();
      scene.add(new A.AmbientLight(0xffffff, 0.55));
      const keyLight = new A.DirectionalLight(0xffffff, 1.15);
      keyLight.position.set(3, 4, 5);
      const fillLight = new A.DirectionalLight(0xffffff, 0.4);
      fillLight.position.set(-4, -2, 1);
      scene.add(keyLight);
      scene.add(fillLight);
      say('viewer 已创建，相机与灯光就位');

      const loop = () => {
        if (disposed) return;
        viewer.render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      // 2. 加载 GLB
      const response = await fetch(ITEM_URL);
      if (!response.ok) throw new Error(`GLB 载入失败: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const parsed = await A.GLTFLoader.loadGLTF(buffer, { textureLoader: A.downloadTexture });
      const model = parsed.scene as any;
      scene.add(model);
      model.updateMatrixWorld(true);
      say(`GLB 已解析：${(buffer.byteLength / 1024).toFixed(1)} KB`);

      // 3. 遍历节点
      const meshes: any[] = [];
      model.traverse((o: any) => {
        if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
      });
      const anims = (parsed.animations || []) as any[];
      const box = new A.Box3().setFromObject(model);
      const size = new A.Vector3();
      box.getSize(size);
      const center = new A.Vector3();
      box.getCenter(center);
      out.model = {
        meshes: meshes.length,
        names: meshes.map((m) => m.name || '(unnamed)'),
        box: [size.x, size.y, size.z].map((v) => Number(v.toFixed(3))),
        animations: anims.length,
      };
      say(`Mesh 节点 ${meshes.length} 个：${out.model.names.join(' / ')}`);
      say(`包围盒尺寸 ${out.model.box.join(' × ')}，动画 ${anims.length} 段`);

      // 相机按包围盒定位（引擎默认 Z 轴朝上）
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
      camera.up.set(0, 0, 1);
      camera.position.set(center.x + radius * 2.2, center.y - radius * 2.2, center.z + radius * 1.5);
      camera.lookAt(center);

      // 4. 逐节点 position
      const nodes = meshes.filter((m) => m.name);
      const anchor = nodes.find((m) => m.name === 'bulb') || nodes[nodes.length - 1];
      const centersBefore = nodes.map((m) => new A.Box3().setFromObject(m).getCenter(new A.Vector3()));
      anchor.position.x += 0.35;
      model.updateMatrixWorld(true);
      viewer.render();
      const centersAfter = nodes.map((m) => new A.Box3().setFromObject(m).getCenter(new A.Vector3()));
      const anchorDelta = [
        centersAfter[nodes.indexOf(anchor)].x - centersBefore[nodes.indexOf(anchor)].x,
        centersAfter[nodes.indexOf(anchor)].y - centersBefore[nodes.indexOf(anchor)].y,
        centersAfter[nodes.indexOf(anchor)].z - centersBefore[nodes.indexOf(anchor)].z,
      ];
      const othersMoved = nodes.filter((m, i) => {
        if (m === anchor) return false;
        const d = centersAfter[i].distanceTo(centersBefore[i]);
        return d > 1e-4;
      }).length;
      out.perNodeMove = {
        node: anchor.name,
        delta: anchorDelta.map((v) => Number(v.toFixed(3))),
        othersMoved,
      };
      say(`单节点平移 ${anchor.name}：位移 ${out.perNodeMove.delta.join(',')}，其它节点位移数 ${othersMoved}`);
      anchor.position.x -= 0.35;
      model.updateMatrixWorld(true);

      // 5. 关节动画
      if (anims.length > 0) {
        const AnimationNS = A.Animation;
        const mixer = new AnimationNS.AnimationMixer(model);
        plugin = new AnimationNS.AnimationPlugin();
        plugin.registerToViewer({ viewer });
        plugin.add(mixer);
        const action = mixer.clipAction(anims[0]);
        action.reset();
        action.weight = 1;
        action.active = true;
        const armNode = model.getObjectByName('arm') as any;
        const before = armNode ? armNode.rotation.z : Number.NaN;
        await new Promise((r) => setTimeout(r, 700));
        viewer.render();
        const after = armNode ? armNode.rotation.z : Number.NaN;
        out.clipPlayback = {
          clip: anims[0].name || '(unnamed)',
          before: Number(before.toFixed(4)),
          after: Number(after.toFixed(4)),
          changed: Math.abs(after - before) > 1e-3,
        };
        say(`关节动画 ${out.clipPlayback.clip}：arm.rotation.z ${out.clipPlayback.before} → ${out.clipPlayback.after}`);
      }

      // 6. 拾取（(0,0) 在 NDC 里是画面中心）
      viewer.render();
      const picker = viewer.createPicker();
      const cameraNow = viewer.getCamera() as any;
      const centerHits = picker.pick(new A.Vector2(0, 0), cameraNow, true) as any[];
      const cornerHits = picker.pick(new A.Vector2(0, 0), cameraNow, true) as any[];
      const hitName = (hits: any[]) => (hits && hits.length > 0 ? String(hits[0].object?.name ?? '(unnamed)') : null);
      out.pick = {
        at00: hitName(centerHits),
        atCorner: hitName(cornerHits.slice(1)),
      };
      say(`拾取 (0,0) 命中：${out.pick.at00 ?? '无'}`);

      out.ok = true;
      setResult(out);
      (window as any).__LAB__ = out;
      say('实验完成');
    };

    run().catch((error) => {
      const out: LabResult = { ok: false, error: String(error?.stack || error) };
      setResult(out);
      (window as any).__LAB__ = out;
      say(`实验失败：${error?.message || error}`);
    });

    const onResize = () => {
      if (!viewer) return;
      viewer.resize();
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      try {
        if (plugin) {
          (viewer as any)?.unregisterPlugin?.(plugin);
          plugin.destroy?.();
        }
        viewer?.destroy?.();
      } catch {
        /* 实验页销毁失败不影响结论 */
      }
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
      <div ref={hostRef} style={{ position: 'relative', minHeight: '100vh' }} />
      <aside style={{ borderLeft: '1px solid #1d222c', padding: 16, fontSize: 13, overflowY: 'auto' }}>
        <h2 style={{ fontSize: 14, margin: '0 0 12px', letterSpacing: 1, color: '#8e97a8' }}>管道实验 / _lab5</h2>
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, color: '#c7cddb' }}>
          {lines.map((line, index) => (
            <li key={index} style={{ listStyle: 'none', marginLeft: -18, color: line.includes('失败') ? '#ff8a8a' : '#c7cddb' }}>
              · {line}
            </li>
          ))}
        </ol>
        {result && !result.ok && (
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ff8a8a', marginTop: 16, fontSize: 12 }}>{result.error}</pre>
        )}
      </aside>
    </div>
  );
}
