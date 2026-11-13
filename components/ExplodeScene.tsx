'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemMeta } from '@/lib/items';

type Phase = 'loading' | 'ready' | 'exploding' | 'exploded';

// 炸开的参数集中在这里，方便调手感
const EXPLODE = {
  spreadFactor: 0.55, // 飞出距离 = 整体最大尺寸 × 该系数
  jitter: 0.18, // 距离随机浮动 ±18%
  staggerMs: 90, // 逐块错开起飞
  durationMs: 760, // 单块飞行时长
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export default function ExplodeScene({ meta }: { meta: ItemMeta }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [partCount, setPartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const replayRef = useRef<() => void>(() => {});

  const replays = useCallback(() => {
    replayRef.current();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const startedAt = performance.now();
    let loadMs = 0;
    let raf = 0;
    let disposed = false;
    let viewer: any = null;

    const run = async () => {
      const A: any = await import('@manycore/aholo-viewer');

      const width = host.clientWidth || 960;
      const height = host.clientHeight || 640;
      viewer = A.createViewer('item', host, { antialiasing: true });
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

      // 实测结论：引擎不做轴向转换，glTF 的 Y-up 原样沿用
      const camera = new A.PerspectiveCamera(38, width / height, 0.01, 200);
      camera.up.set(0, 1, 0);
      viewer.setCamera(camera);

      const scene = viewer.getScene();
      scene.add(new A.AmbientLight(0xffffff, 0.62));
      const key = new A.DirectionalLight(0xffffff, 1.05);
      key.position.set(2.5, 3.5, 2.5);
      scene.add(key);
      const rim = new A.DirectionalLight(0xdfe7ff, 0.55);
      rim.position.set(-2.5, 1.2, -3);
      scene.add(rim);

      const response = await fetch(`/items/${meta.id}/model.glb`);
      if (!response.ok) throw new Error(`模型载入失败 HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const parsed = await A.GLTFLoader.loadGLTF(buffer, { textureLoader: A.downloadTexture });
      const model = parsed.scene as any;
      scene.add(model);
      model.updateMatrixWorld(true);

      // 零件 = 模型根下的 Mesh 子节点（实测拆分产物就是 7 个直接子节点）
      const meshes: any[] = [];
      model.traverse((o: any) => {
        if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
      });

      const box = new A.Box3().setFromObject(model);
      const size = box.getSize(new A.Vector3());
      const center = box.getCenter(new A.Vector3());
      const maxSize = Math.max(size.x, size.y, size.z) || 1;

      // 每块的静止位、飞出方向、飞出距离、起飞延迟
      const raw = meshes.map((mesh, index) => {
        const partCenter = new A.Box3().setFromObject(mesh).getCenter(new A.Vector3());
        const rest = mesh.position.clone();
        const dir = partCenter.clone().sub(center);
        if (dir.length() < maxSize * 0.02) {
          // 中心几乎重合的零件沿竖直方向推出，避免原地不动
          dir.set(0, 1, 0);
        }
        dir.normalize();
        return { mesh, index, rest, dir, partCenter };
      });

      // 中心被别的零件包住的（灯泡在灯罩里、接头在罩口），方向会和包住它的那块几乎相同，
      // 单纯按同方向飞出会叠在一起。给这类块额外加飞距，让它在同方向上穿出去。
      const parts = raw.map((part) => {
        const crowded = raw.filter(
          (other) => other !== part && other.partCenter.distanceTo(part.partCenter) < maxSize * 0.07,
        ).length;
        const jitter = 1 + (Math.random() * 2 - 1) * EXPLODE.jitter;
        const boost = crowded > 0 ? 1.65 : 1;
        return {
          ...part,
          dist: maxSize * EXPLODE.spreadFactor * jitter * boost,
          delay: 0,
          spread: part.partCenter.distanceTo(center),
        };
      });

      // 越靠外的零件越先飞
      const ordered = parts.slice().sort((a, b) => b.spread - a.spread);
      ordered.forEach((part, order) => {
        part.delay = order * EXPLODE.staggerMs;
      });

      // 相机按"炸开后的实际分布"取景：以各块终点重心的为中心，半径按最远一块算
      const ends = parts.map((part) =>
        part.partCenter.clone().add(part.dir.clone().multiplyScalar(part.dist)),
      );
      const cloudCenter = ends
        .reduce((acc, p) => acc.add(p), new A.Vector3())
        .multiplyScalar(1 / (ends.length || 1));
      const cloudRadius =
        ends.reduce((max, p) => Math.max(max, p.distanceTo(cloudCenter)), 0) + maxSize * 0.32;
      const fovY = (38 * Math.PI) / 180;
      const distance = (cloudRadius / Math.tan(fovY / 2)) * 0.9;
      const viewDir = new A.Vector3(0.82, 0.42, 1.0).normalize();
      camera.position.set(
        cloudCenter.x + viewDir.x * distance,
        cloudCenter.y + viewDir.y * distance,
        cloudCenter.z + viewDir.z * distance,
      );
      camera.lookAt(cloudCenter);
      camera.updateMatrixWorld?.(true);
      camera.updateProjectionMatrix?.();
      viewer.render();

      const animate = () => {
        const animStart = performance.now();
        const total = parts.reduce((m, p) => Math.max(m, p.delay + EXPLODE.durationMs), 0);
        let finished = false;
        const tick = (now: number) => {
          if (disposed) return;
          const elapsed = now - animStart;
          for (const part of parts) {
            const raw = (elapsed - part.delay) / EXPLODE.durationMs;
            const k = raw < 0 ? 0 : raw > 1 ? 1 : raw;
            const e = easeOutCubic(k);
            part.mesh.position.set(
              part.rest.x + part.dir.x * part.dist * e,
              part.rest.y + part.dir.y * part.dist * e,
              part.rest.z + part.dir.z * part.dist * e,
            );
          }
          model.updateMatrixWorld(true);
          viewer.render();
          if (!finished && elapsed >= total) {
            finished = true;
            setPhase('exploded');
            (window as any).__SCENE__ = {
              id: meta.id,
              phase: 'exploded',
              parts: parts.length,
              loadMs: Math.round(loadMs),
              totalMs: Math.round(performance.now() - startedAt),
            };
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      };

      replayRef.current = () => {
        cancelAnimationFrame(raf);
        setPhase('exploding');
        (window as any).__SCENE__ = { id: meta.id, phase: 'exploding', parts: parts.length };
        animate();
      };

      loadMs = performance.now() - startedAt;
      setPartCount(parts.length);
      setPhase('ready');
      (window as any).__SCENE__ = {
        id: meta.id,
        phase: 'ready',
        parts: parts.length,
        loadMs: Math.round(loadMs),
      };
      // 模型一就位就炸开，不等用户点击
      replayRef.current();
    };

    run().catch((error) => {
      // 失败要在界面上说清楚，不能假装成功
      setPhase('loading');
      setError(String(error?.message || error));
      (window as any).__SCENE__ = { id: meta.id, phase: 'error', error: String(error?.message || error) };
    });

    const onResize = () => viewer?.resize?.();
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      try {
        viewer?.destroy?.();
      } catch {
        /* 卸载失败不影响页面 */
      }
    };
  }, [meta.id]);

  return (
    <main style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />

      {error && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(15,17,21,0.92)',
          }}
        >
          <div style={{ maxWidth: 460, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#ff8a8a', letterSpacing: 1 }}>模型没能载入</div>
            <div style={{ fontSize: 12, color: '#8f98a8', marginTop: 10, lineHeight: 1.8 }}>{error}</div>
          </div>
        </div>
      )}

      {/* 顶部：品牌 + 四步流程轨 */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          pointerEvents: 'none',
        }}
      >
        <div>
          <div style={{ fontSize: 15, letterSpacing: 2, color: '#e8eaf0' }}>拆了寄给你</div>
          <div style={{ fontSize: 11, color: '#6d7688', marginTop: 4, letterSpacing: 1 }}>CHAI LE JI GEI NI</div>
        </div>
        <Track />
      </header>

      {/* 底部：状态与操作 */}
      <footer
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '20px 24px 26px 84px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          pointerEvents: 'none',
        }}
      >
        <div style={{ fontSize: 12, lineHeight: 1.9, color: '#8f98a8' }}>
          <div>
            {partCount > 0 ? `${partCount} 个零件 · 由 Lux3D 拆自一件真实物品` : '正在载入零件'}
          </div>
          <div style={{ color: '#6d7688' }}>{phase === 'exploded' ? '零件已全部散开。' : '零件正在飞出…'}</div>
        </div>
        <button
          type="button"
          onClick={replays}
          style={{
            pointerEvents: 'auto',
            border: '1px solid #2a3140',
            background: 'rgba(20,24,31,0.7)',
            color: '#c9d1e0',
            fontSize: 12,
            letterSpacing: 1,
            padding: '9px 16px',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          重新炸开
        </button>
      </footer>
    </main>
  );
}

const STEPS = [
  { label: '图生 3D', state: 'done' as const },
  { label: '拆分', state: 'done' as const },
  { label: '关节', state: 'pending' as const },
  { label: '导出', state: 'done' as const },
];

function Track() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {STEPS.map((step, index) => (
        <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {index > 0 && <div style={{ width: 18, height: 1, background: '#242a36' }} />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: step.state === 'done' ? '#ffc98a' : '#39414f',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 11, letterSpacing: 1, color: step.state === 'done' ? '#c9d1e0' : '#5d6575' }}>
              {step.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
