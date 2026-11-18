'use client';

import { useEffect, useRef, useState } from 'react';

type Piece = {
  /** 起飞次序 */
  rank?: number;
  mesh: any;
  /** 在整件东西里的相对高度：-0.5 底座，+0.5 灯头 */
  yNorm: number;
  /** 从整体中心指向这一块的单位向量：它沿着自己的真实方位飞出去 */
  dir: { x: number; y: number; z: number };
  axis: any;
  spin: number;
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
        if (o.isMesh || o.isSkinnedMesh) {
          meshes.push(o);
          // Lux3D 出的白模（PBR 很弱）在暗场上像石膏；统一压成墨色，结构线才立得住
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m: any) => {
            if (!m) return;
            m.color?.set?.(0x14161b);
            if ('roughness' in m) m.roughness = 0.52;
            if ('metalness' in m) m.metalness = 0.22;
            if (m.map) m.map = null;
            m.needsUpdate = true;
          });
        }
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

      // 离心爆开：每块沿自己相对整件中心的方向飞出去，方位就是它原本的方位
      const pieces: Piece[] = meshes.map((mesh, index) => {
        const c = new A.Box3().setFromObject(mesh).getCenter(new A.Vector3());
        const yNorm = size.y > 0 ? (c.y - center.y) / size.y : 0;
        const dx = c.x - center.x;
        const dy = c.y - center.y;
        const dz = c.z - center.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        // 中心附近的零件（灯泡、垫圈）方位退化，按索引绕一圈分开
        const tiny = len < maxSize * 0.045;
        const ang = (index / Math.max(1, meshes.length)) * Math.PI * 2;
        const r1 = rnd(index);
        return {
          mesh,
          yNorm,
          dir: tiny
            ? { x: Math.cos(ang) * 0.8, y: 0.5, z: Math.sin(ang) * 0.8 }
            : { x: dx / len, y: dy / len, z: dz / len },
          axis: new A.Vector3(rnd(index + 3) - 0.5, rnd(index + 5) - 0.5, rnd(index + 11) - 0.5).normalize(),
          spin: 0.16 + r1 * 0.2,
          seed: r1,
        };
      });

      // 起飞次序：离中心越远越早，跟参考里"零件错开飞出"一致
      const bySpread = [...pieces].sort(
        (a, b) =>
          Math.hypot(b.dir.x, b.dir.y, b.dir.z) - Math.hypot(a.dir.x, a.dir.y, a.dir.z),
      );
      pieces.forEach((piece) => {
        piece.rank = 0;
      });
      bySpread.forEach((piece, i) => {
        piece.rank = i;
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

      // 可以绕过滚动：点按钮直接把进度推到“拆开”
      let auto: number | null = null;
      const onScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const raw = max > 0 ? window.scrollY / max : 0;
        if (auto === null) progress = clamp(raw);
        (window as any).__HERO_PROGRESS__ = progress;
      };
      (window as any).__HERO_OPEN__ = () => {
        auto = 0.58;
      };
      (window as any).__HERO_RESET__ = () => {
        auto = null;
        onScroll();
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
        smooth += ((auto ?? progress) - smooth) * 0.085;
        const p = smooth;

        // 第一帧就要看得见东西：一开始就有主光和轮廓，越拆越亮
        const lit = easeInOut(clamp((p - 0.05) / 0.2));
        ambient.intensity = 0.3 - 0.09 * lit;
        key.intensity = 1.3 + 0.7 * lit;
        fill.intensity = 0.36 + 0.2 * lit;
        rim.intensity = 1.05 + 0.65 * lit;

        let openSum = 0;
        let openPeak = 0;
        pieces.forEach((piece, i) => {
          const rev = pieces.length - 1 - i;
          let o: number;
          if (p < 0.82) {
            // 第一拍先停着，第二拍按次序错开飞出
            o = easeOut(clamp((p - 0.34 - (piece.rank ?? 0) * 0.017) / 0.17));
          } else {
            // 第三拍：落稳之后才收，收的时候冲过头再弹回来
            const k = clamp((p - 0.82 - rev * 0.006) / 0.14);
            o = 1 - easeIn(k) - Math.sin(k * Math.PI) * 0.055 * (1 - k);
          }
          openSum += o;
          openPeak = Math.max(openPeak, o);

          // 沿自身方位飞出，越在外面的走得越远；带一点重力下坠和自转
          const spread = maxSize * 0.24 * o;
          const breathe = Math.sin(t * 0.9 + piece.seed * 6.28) * maxSize * 0.012 * Math.max(0, Math.min(1, (o - 0.6) / 0.4));
          piece.mesh.position.set(
            piece.dir.x * spread * 1.2,
            piece.dir.y * spread + breathe - o * o * maxSize * 0.05,
            piece.dir.z * spread * 1.0,
          );
          piece.mesh.quaternion.setFromAxisAngle(piece.axis, piece.spin * o);
        });

        // 亮灯：p=1 之前一瞬，纸面上洇开一团影
        const glow = clamp((p - 0.9) / 0.08);
        lightLevel += (glow * 4.4 - lightLevel) * 0.1;
        bulb.intensity = lightLevel;
        bulb.position.set(center.x, center.y + size.y * 0.26, center.z);

        // 第三拍只属于镜头：散完之后再慢慢退，退的过程里零件是静的
        const pullBack = easeInOut(clamp((p - 0.46) / 0.32));
        const zoom = 1.02 * (1 + openPeak * 0.5 + pullBack * 0.24);
        const a = 0.22 + p * 0.42 + mouseRef.current * 0.34;
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
        pieces: pieces.map((x) => ({ yNorm: x.yNorm, dir: x.dir })),
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
