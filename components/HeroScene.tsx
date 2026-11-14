'use client';

import { useEffect, useRef, useState } from 'react';

type Piece = {
  mesh: any;
  /** 在整件东西里的相对高度：-0.5 底座，+0.5 灯头 */
  yNorm: number;
  /** 横向偏移（只给线和插头一点，避免全挤在一条轴上） */
  drift: number;
  seed: number;
};

/**
 * 首页：滚动驱动的"印刷图站起来"。
 * 0    —— 平光黑剪影，像印在纸上的一枚图
 * 0.1  —— 光渐亮，它从纸面立起来
 * 0.15 —— 七块沿着各自的轴脱开，边转边退
 * 0.8  —— 反序合体，带一点过冲
 * 1    —— 底座亮起，纸面上洇开一团影
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
    let progress = 0;

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
      const ambient = new A.AmbientLight(0xffffff, 1);
      scene.add(ambient);
      const key = new A.DirectionalLight(0xfff1de, 0);
      key.position.set(2.4, 3.0, 2.2);
      scene.add(key);
      const fill = new A.DirectionalLight(0x7f96c4, 0);
      fill.position.set(-2.4, 1.2, 1.8);
      scene.add(fill);
      const rim = new A.DirectionalLight(0xffd7ae, 0);
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
      const radius = maxSize * 0.5;

      const rnd = (n: number) => {
        const s = Math.sin(n * 127.1 + 31.7) * 43758.5453;
        return s - Math.floor(s);
      };

      // 竖向爆炸图：每块按自己在整件里的高度分开，顺序不乱，像一张装配示意
      const pieces: Piece[] = meshes.map((mesh, index) => {
        const c = new A.Box3().setFromObject(mesh).getCenter(new A.Vector3());
        const yNorm = size.y > 0 ? (c.y - center.y) / size.y : 0;
        const r1 = rnd(index);
        return {
          mesh,
          yNorm,
          drift: (r1 - 0.5) * maxSize * 0.1,
          seed: r1,
        };
      });

      // 把每块的实际高度写进 CSS 变量，让右页边的清单跟零件对齐（自上而下）
      const ordered = [...pieces].sort((a, b) => b.yNorm - a.yNorm);
      const tops = ordered.map((pc) => 50 - pc.yNorm * 74);
      // 高度太近的零件会把标签叠在一起，按最小行距往下推开
      for (let i = 1; i < tops.length; i += 1) tops[i] = Math.max(tops[i], tops[i - 1] + 3.4);
      const shift = Math.min(0, 94 - tops[tops.length - 1]);
      tops.forEach((t, i) => {
        const top = Math.max(8, Math.min(92, t + shift));
        document.documentElement.style.setProperty(`--m${i + 1}`, `${top.toFixed(1)}%`);
      });
      const fovY = (camera.fov * Math.PI) / 180;
      const distV = (radius * 1.18) / Math.tan(fovY / 2);
      const aspect = width / height;
      const distH = aspect < 1 ? (radius * 1.22) / Math.tan(fovY / 2) / aspect : distV;
      const dist = Math.max(distV, distH) * 1.14;

      const lookAt = new A.Vector3(center.x, center.y - size.y * 0.02, center.z);
      const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
      const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
      const easeIn = (k: number) => k * k * k;
      const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

      const onScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const raw = max > 0 ? window.scrollY / max : 0;
        progress = clamp(raw);
        (window as any).__HERO_PROGRESS__ = progress;
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);

      let smooth = 0;
      let lightLevel = 0;
      const t0 = performance.now();

      const frame = () => {
        if (disposed) return;
        const t = (performance.now() - t0) / 1000;
        smooth += (progress - smooth) * 0.085;
        const p = smooth;

        // 平光 → 立体：光在 0.04→0.30 之间渐次上来
        const lit = easeInOut(clamp((p - 0.04) / 0.26));
        ambient.intensity = 1.05 - 0.83 * lit;
        key.intensity = 2.0 * lit;
        fill.intensity = 0.55 * lit;
        rim.intensity = 1.7 * lit;

        let openSum = 0;
        pieces.forEach((piece, i) => {
          const rev = pieces.length - 1 - i;
          let o: number;
          if (p < 0.62) {
            o = easeOut(clamp((p - 0.14 - i * 0.022) / 0.3));
          } else {
            const k = clamp((p - 0.62 - rev * 0.012) / 0.16);
            // 合体时给一点过冲：先冲过头再弹回来
            o = 1 - easeIn(k) - Math.sin(k * Math.PI) * 0.045 * (1 - k);
          }
          openSum += o;

          // 竖向位移：上半部的零件往上走，下半部的往下走，间隔均匀
          const lift = piece.yNorm * maxSize * 1.15 * o;
          const breathe = Math.sin(t * 0.9 + piece.seed * 6.28) * maxSize * 0.012 * Math.max(0, Math.min(1, (o - 0.6) / 0.4));
          piece.mesh.position.set(
            piece.drift * o * 0.5,
            lift + breathe,
            0,
          );
          piece.mesh.quaternion.set(0, 0, 0, 1);
        });

        // 亮灯：p=1 之前一瞬，纸面上洇开一团影
        const glow = clamp((p - 0.86) / 0.1);
        lightLevel += (glow * 4.4 - lightLevel) * 0.1;
        bulb.intensity = lightLevel;
        bulb.position.set(center.x, center.y + size.y * 0.26, center.z);

        const openAvg = openSum / Math.max(1, pieces.length);
        const zoom = (1 + (1 - clamp(p / 0.28)) * 0.05) * (1 + openAvg * 0.95);
        const a = 0.14 - p * 0.22 + mouseRef.current * 0.30;
        camera.position.set(
          lookAt.x + Math.sin(a) * dist * zoom,
          lookAt.y + dist * (0.14 + p * 0.05),
          lookAt.z + Math.cos(a) * dist * zoom,
        );
        camera.lookAt(lookAt);
        camera.updateMatrixWorld?.(true);

        model.updateMatrixWorld(true);
        viewer.render();
        raf = requestAnimationFrame(frame);
      };

      (window as any).__HERO__ = {
        size: { x: size.x, y: size.y, z: size.z },
        center: { x: center.x, y: center.y, z: center.z },
        radius,
        dist,
        pieces: pieces.map((x) => ({ yNorm: x.yNorm, drift: x.drift })),
      };
      setReady(true);
      raf = requestAnimationFrame(frame);

      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
      };
    };

    let cleanup: void | (() => void);
    boot()
      .then((fn) => {
        cleanup = fn as any;
      })
      .catch((err) => {
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
        cleanup?.();
      } catch {
        /* ignore */
      }
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
