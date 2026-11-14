'use client';

import { useEffect, useRef, useState } from 'react';

type Piece = {
  mesh: any;
  dir: { x: number; y: number; z: number };
  bob: number;
};

/**
 * 首页那只"会自己拆开又装回去"的灯。
 * 时间轴循环：静置 → 炸开 → 悬浮 → 合体 → 抬头亮灯 → 熄灭重来。
 */
export default function HeroScene({ src = '/items/lamp/model.glb' }: { src?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const mouseRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    const host = hostRef.current;
    if (!host) return;

    let viewer: any = null;

    const boot = async () => {
      const A: any = await import('@manycore/aholo-viewer');
      const width = host.clientWidth || 1200;
      const height = host.clientHeight || 720;

      viewer = A.createViewer('hero', host, { antialiasing: true });
      viewer.config.coordinateSystem.enabled.set(false);
      A.setViewerConfig(viewer, {
        pipeline: {
          Background: {
            background: {
              active: A.BackgroundMode.BasicBackground,
              basic: { color: new A.Color(0.031, 0.035, 0.043) },
            },
            ground: { enabled: false },
          },
          Splatting: { enabled: true },
          TAA: { enabled: false },
        },
      });

      const camera = new A.PerspectiveCamera(36, width / height, 0.01, 200);
      camera.up.set(0, 1, 0);
      viewer.setCamera(camera);

      const scene = viewer.getScene();
      scene.add(new A.AmbientLight(0x8b9bb8, 0.22));
      const key = new A.DirectionalLight(0xfff1de, 2.0);
      key.position.set(2.4, 3.0, 2.2);
      scene.add(key);
      const fill = new A.DirectionalLight(0x7f96c4, 0.55);
      fill.position.set(-2.4, 1.2, 1.8);
      scene.add(fill);
      const rim = new A.DirectionalLight(0xffd7ae, 1.6);
      rim.position.set(-0.6, 1.2, -3.2);
      scene.add(rim);
      const bulb = new A.PointLight(0xffb273, 0);
      scene.add(bulb);

      const loadBuffer = (attempt: number) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', `${src}${attempt > 0 ? `?retry=${attempt}` : ''}`);
          xhr.responseType = 'arraybuffer';
          let last = -1;
          xhr.onprogress = (ev) => {
            if (disposed) return;
            if (!ev.lengthComputable || !ev.total) return;
            const p = Math.min(1, ev.loaded / ev.total);
            if (p - last >= 0.02 || p >= 1) {
              last = p;
              setPct(p);
            }
          };
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response) : reject(new Error(`HTTP ${xhr.status}`));
          xhr.onerror = () => reject(new Error('load failed'));
          xhr.send();
        });

      // 页面间快速跳转会打断在途的 16MB 请求（dev 下表现为 ERR_CACHE_WRITE_FAILURE）
      const buffer = await loadBuffer(0).catch(async (first) => {
        if (disposed) throw first;
        await new Promise((r) => setTimeout(r, 320));
        return loadBuffer(1);
      });

      const parsed = await A.GLTFLoader.loadGLTF(buffer, { textureLoader: A.downloadTexture });
      if (disposed) return;
      const model = parsed.scene as any;
      scene.add(model);
      model.updateMatrixWorld(true);

      const meshes: any[] = [];
      model.traverse((o: any) => {
        if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
      });

      const box = new A.Box3().setFromObject(model);
      const size = box.getSize(new A.Vector3());
      const center = box.getCenter(new A.Vector3());
      const maxSize = Math.max(size.x, size.y, size.z) || 1;
      const radius = Math.max(size.x, size.y, size.z) * 0.5;

      const pieces: Piece[] = meshes.map((mesh, index) => {
        const c = new A.Box3().setFromObject(mesh).getCenter(new A.Vector3());
        const dx = c.x - center.x;
        const dy = c.y - center.y;
        const dz = c.z - center.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        // 方向几乎重合的零件（比如灯泡与灯罩）靠索引错开，避免全部叠在一条线上
        const jitter = index % 2 === 0 ? 0.12 : -0.12;
        return {
          mesh,
          dir: { x: dx / len + jitter, y: dy / len, z: dz / len + jitter * 0.4 },
          bob: index * 0.7,
        };
      });

      // 取景：让整灯在竖屏也不被裁
      const fovY = (camera.fov * Math.PI) / 180;
      const distV = (radius * 1.18) / Math.tan(fovY / 2);
      const aspect = width / height;
      const distH = aspect < 1 ? (radius * 1.22) / Math.tan(fovY / 2) / aspect : distV;
      let dist = Math.max(distV, distH) * 1.16;

      const lookAt = new A.Vector3(center.x, center.y - size.y * 0.02, center.z);
      const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
      const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
      const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

      const LOOP = 13.2;
      const t0 = performance.now();
      let lightLevel = 0;

      const frame = () => {
        if (disposed) return;
        const t = ((performance.now() - t0) / 1000) % LOOP;

        // 每个零件自己的开合进度：错峰 60ms，合体时反序
        const openOf = (i: number) => {
          const stagger = i * 0.07;
          if (t < 1.7) return 0;
          if (t < 3.5) return easeOut(clamp((t - 1.7 - stagger) / 1.35));
          if (t < 6.4) return 1;
          if (t < 8.0) {
            const rev = pieces.length - 1 - i;
            return 1 - easeInOut(clamp((t - 6.4 - rev * 0.07) / 1.4));
          }
          return 0;
        };

        let openSum = 0;
        pieces.forEach((p, i) => {
          const open = openOf(i);
          openSum += open;
          const spread = maxSize * 0.36 * open;
          const bobY = Math.sin(t * 1.15 + p.bob) * maxSize * 0.028 * open;
          p.mesh.position.set(p.dir.x * spread, p.dir.y * spread + bobY, p.dir.z * spread);
        });

        // 亮灯：8.2s 起爬升，10.6s 到顶，12.6s 熄灭
        let target = 0;
        if (t > 8.2) target = clamp((t - 8.2) / 0.55) * 4.2;
        if (t > 10.9) target = 4.2;
        if (t > 12.5) target = 0;
        lightLevel += (target - lightLevel) * 0.12;
        bulb.intensity = lightLevel;
        const bulbCenter = new A.Vector3(center.x, center.y + size.y * 0.28, center.z);
        bulb.position.set(bulbCenter.x, bulbCenter.y, bulbCenter.z);

        // 镜头：极缓环绕 + 鼠标横移带来的偏转
        const swing = Math.sin(t * 0.16) * 0.12 + mouseRef.current * 0.5;
        const a = 0.42 + swing;
        // 炸开时镜头跟着退，合体时再压回来：拆得越开，看得越全
        const openAvg = openSum / Math.max(1, pieces.length);
        const dolly = 1 + openAvg * 0.62;
        const zoom = (1 - clamp((t - 8.2) / 3.2) * 0.06) * dolly;
        camera.position.set(
          lookAt.x + Math.sin(a) * dist * zoom,
          lookAt.y + dist * 0.16,
          lookAt.z + Math.cos(a) * dist * zoom,
        );
        camera.lookAt(lookAt);
        camera.updateMatrixWorld?.(true);

        // 引擎不自动出图，每帧显式渲染
        model.updateMatrixWorld(true);
        viewer.render();

        raf = requestAnimationFrame(frame);
      };

      (window as any).__HERO__ = { size: { x: size.x, y: size.y, z: size.z }, center: { x: center.x, y: center.y, z: center.z }, radius, dist, pieces: pieces.map((p) => ({ dir: p.dir })) };
      setReady(true);
      raf = requestAnimationFrame(frame);
    };

    boot().catch((err) => {
      if (!disposed) setPct(0);
      console.error('[hero]', err);
    });

    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      mouseRef.current = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    };
    host.addEventListener('pointermove', onMove);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      host.removeEventListener('pointermove', onMove);
      try {
        viewer?.dispose?.();
      } catch {
        /* 引擎卸载失败不影响页面 */
      }
    };
  }, [src]);

  return (
    <div className="hero-stage">
      <div ref={hostRef} className="hero-canvas" />
      {!ready && (
        <div className="hero-loading">
          <span>正在拆包</span>
          <span className="hero-loading-pct">{pct === null ? '…' : `${Math.round(pct * 100)}%`}</span>
        </div>
      )}
    </div>
  );
}
