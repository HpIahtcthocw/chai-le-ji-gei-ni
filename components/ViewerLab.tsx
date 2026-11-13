'use client';

import { useEffect, useRef, useState } from 'react';

// 实验页：用浏览器真机回答阶段 1 的四个问题。
// ?item=_lab5（合成测试件，带节点名 + 关节动画）| ?item=lamp（真实 Lux3D 拆分产物，节点无名字）
type LabResult = {
  ok: boolean;
  item?: string;
  error?: string;
  model?: {
    sceneChildren: number;
    meshes: number;
    animations: number;
    size: number[];
    center: number[];
  };
  parts?: { id: string; name: string; parent: string; size: number[]; center: number[] }[];
  perNodeMove?: { node: string; delta: number[]; othersMoved: number; total: number };
  clipPlayback?: { clip: string; node: string; before: number; after: number; changed: boolean } | { skipped: string };
  pick?: Record<string, string | null>;
};

const getItem = () => {
  if (typeof window === 'undefined') return '_lab5';
  return new URLSearchParams(window.location.search).get('item') || '_lab5';
};

export default function ViewerLab() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [result, setResult] = useState<LabResult | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const item = getItem();
    let raf = 0;
    let disposed = false;
    let viewer: any = null;
    let plugin: any = null;
    const say = (line: string) => setLines((prev) => [...prev, line]);

    const run = async () => {
      const A: any = await import('@manycore/aholo-viewer');
      const out: LabResult = { ok: false, item };

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
      scene.add(keyLight);
      const fillLight = new A.DirectionalLight(0xffffff, 0.4);
      fillLight.position.set(-4, -2, 1);
      scene.add(fillLight);
      say(`viewer 已创建（视口 ${width}×${height}）`);

      const loop = () => {
        if (disposed) return;
        viewer.render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      // 2. 加载 GLB
      const url = `/items/${item}/model.glb`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`GLB 载入失败: HTTP ${response.status} ${url}`);
      const buffer = await response.arrayBuffer();
      const parsed = await A.GLTFLoader.loadGLTF(buffer, { textureLoader: A.downloadTexture });
      const model = parsed.scene as any;
      scene.add(model);
      model.updateMatrixWorld(true);
      say(`GLB 已解析：${url} · ${(buffer.byteLength / 1024).toFixed(1)} KB`);

      // 3. 遍历节点：记录每个 Mesh 的父子关系与包围盒
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
        sceneChildren: model.children?.length ?? -1,
        meshes: meshes.length,
        animations: anims.length,
        size: [size.x, size.y, size.z].map((v) => Number(v.toFixed(3))),
        center: [center.x, center.y, center.z].map((v) => Number(v.toFixed(3))),
      };
      out.parts = meshes.map((m, i) => {
        const b = new A.Box3().setFromObject(m);
        const s = b.getSize(new A.Vector3());
        const c = b.getCenter(new A.Vector3());
        return {
          id: `part-${i}`,
          name: m.name || '(unnamed)',
          parent: m.parent?.name || (m.parent === model ? 'model-root' : '(unnamed-parent)'),
          size: [s.x, s.y, s.z].map((v) => Number(v.toFixed(3))),
          center: [c.x, c.y, c.z].map((v) => Number(v.toFixed(3))),
        };
      });
      say(`场景根子节点 ${out.model.sceneChildren} 个 · Mesh ${meshes.length} 个 · 动画 ${anims.length} 段`);
      say(`整体尺寸 ${out.model.size.join(' × ')}`);

      // 相机：实测引擎不做轴转换，glTF 的 Y-up 直接沿用，上轴固定 (0,1,0)
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
      camera.up.set(0, 1, 0);
      say('相机上轴固定 Y-up（实测：引擎不转换 glTF 轴向）');
      camera.position.set(center.x + radius * 1.9, center.y + radius * 1.0, center.z + radius * 1.9);
      camera.lookAt(center);
      // 改完相机必须显式刷矩阵，否则射线用的是旧矩阵，拾取会全空
      (camera as any).updateMatrixWorld?.(true);
      (camera as any).updateProjectionMatrix?.();
      viewer.render();

      // 4. 拾取坐标口径：两种口径各扫 5×5 网格，命中数多的那个就是真口径
      const picker = viewer.createPicker();
      const cameraNow = viewer.getCamera() as any;
      const hitName = (hits: any[]) => (hits && hits.length > 0 ? String(hits[0].object?.name || '(unnamed)') : null);
      const sweep = (mode: 'ndc' | 'pixel', n = 5) => {
        let hits = 0;
        let first: string | null = null;
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const u = ((i + 0.5) / n) * 2 - 1;
            const v = ((j + 0.5) / n) * 2 - 1;
            const vec =
              mode === 'ndc'
                ? new A.Vector2(u, v)
                : new A.Vector2(((u + 1) / 2) * width, ((1 - v) / 2) * height);
            try {
              const got = hitName(picker.pick(vec, cameraNow, true, meshes) as any[]);
              if (got) {
                hits += 1;
                if (!first) first = got;
              }
            } catch {
              /* 该点抛错不影响统计 */
            }
          }
        }
        return { mode, hits, first };
      };
      const ndcSweep = sweep('ndc');
      const pixelSweep = sweep('pixel');
      out.pick = {
        ndc00: (() => {
          try {
            return hitName(picker.pick(new A.Vector2(0, 0), cameraNow, true, meshes) as any[]);
          } catch {
            return '抛错';
          }
        })(),
        ndcHits: `${ndcSweep.hits}/25`,
        ndcFirst: ndcSweep.first,
        pixelHits: `${pixelSweep.hits}/25`,
        pixelFirst: pixelSweep.first,
        verdict: ndcSweep.hits === pixelSweep.hits ? '无法判定' : ndcSweep.hits > pixelSweep.hits ? 'NDC(-1..1)' : '像素坐标',
      };
      say(`拾取网格扫描：NDC ${ndcSweep.hits}/25 · 像素 ${pixelSweep.hits}/25 → 判定 ${out.pick?.verdict ?? '未判定'}`);

      // 5. 逐节点平移：只动第一个 Mesh，看其余是否被带动
      const before = meshes.map((m) => new A.Box3().setFromObject(m).getCenter(new A.Vector3()));
      const anchor = meshes[0];
      anchor.position.x += radius * 0.6;
      model.updateMatrixWorld(true);
      viewer.render();
      const after = meshes.map((m) => new A.Box3().setFromObject(m).getCenter(new A.Vector3()));
      const anchorIdx = 0;
      const delta = after[anchorIdx].clone().sub(before[anchorIdx]);
      const othersMoved = meshes.filter((m, i) => i !== anchorIdx && after[i].distanceTo(before[i]) > 1e-4).length;
      out.perNodeMove = {
        node: `part-${anchorIdx}`,
        delta: [delta.x, delta.y, delta.z].map((v) => Number(v.toFixed(3))),
        othersMoved,
        total: meshes.length,
      };
      say(`平移 part-0：位移 ${out.perNodeMove.delta.join(',')} · 被带动 ${othersMoved}/${meshes.length - 1}`);
      anchor.position.x -= radius * 0.6;
      model.updateMatrixWorld(true);

      // 6. 关节动画（没动画就明确记录跳过，不硬编造）
      if (anims.length === 0) {
        out.clipPlayback = { skipped: '该 GLB 不含动画' };
        say('无动画，跳过播放测试');
      } else {
        const AnimationNS = A.Animation;
        const mixer = new AnimationNS.AnimationMixer(model);
        plugin = new AnimationNS.AnimationPlugin();
        plugin.registerToViewer({ viewer });
        plugin.add(mixer);
        const action = mixer.clipAction(anims[0]);
        action.reset();
        action.weight = 1;
        action.active = true;
        // 找一个动画真正会驱动的节点：优先带名字的 arm，否则用第一个 Mesh
        const samples: any[] = [];
        const pickNode = model.getObjectByName?.('arm') || meshes[0];
        const sampleRot = () => {
          if (!pickNode) return Number.NaN;
          const e = pickNode.rotation;
          return (e && typeof e.z === 'number' ? e.z : Number.NaN) as number;
        };
        const before = sampleRot();
        await new Promise((r) => setTimeout(r, 700));
        viewer.render();
        const after = sampleRot();
        samples.push(pickNode);
        out.clipPlayback = {
          clip: anims[0].name || '(unnamed)',
          node: pickNode?.name || '(unnamed)',
          before: Number.isNaN(before) ? 0 : Number(before.toFixed(4)),
          after: Number.isNaN(after) ? 0 : Number(after.toFixed(4)),
          changed: !Number.isNaN(before) && !Number.isNaN(after) && Math.abs(after - before) > 1e-3,
        };
        say(`动画 ${out.clipPlayback.clip}：${out.clipPlayback.node}.rotation.z ${out.clipPlayback.before} → ${out.clipPlayback.after}（${out.clipPlayback.changed ? '变了' : '没变'}）`);
      }

      out.ok = true;
      setResult(out);
      (window as any).__LAB__ = out;
      say('实验完成');
    };

    run().catch((error) => {
      const out: LabResult = { ok: false, item, error: String(error?.stack || error) };
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
        <h2 style={{ fontSize: 14, margin: '0 0 12px', letterSpacing: 1, color: '#8e97a8' }}>管道实验</h2>
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
