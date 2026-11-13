'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItemMeta } from '@/lib/items';

// 一块一块到货：拼上的零件留在原位，未到的零件藏在画面外。
// 猜谜按"第 k 块猜中得 round(100 × (N−k+1)/N)"记分，猜错扣 10 分（最低 10）。

type Phase = 'loading' | 'playing' | 'ask' | 'finished' | 'error';

const SNAP_RATIO = 0.08; // 吸合半径 = 模型最大尺寸 × 8%
const ARRIVE_MS = 420;
const SNAP_MS = 260;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c = 1.28;
  const p = t - 1;
  return 1 + (c + 1) * p * p * p + c * p * p;
};

type QuizState = { options: string[]; answerIndex: number; partLabel: string };

export default function GameScene({ meta }: { meta: ItemMeta }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(0);
  const [score, setScore] = useState(0);
  const [solved, setSolved] = useState(false);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // 引擎侧的可变状态放 ref，避免 React 重渲染打断动画
  const ctrlRef = useRef<{ answer: (index: number) => void }>({ answer: () => {} });
  const markerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let viewer: any = null;
    let camera: any = null;
    let picker: any = null;
    let activeMesh: any = null;
    let activeIndex = 0;
    let maxSize = 1;
    let stagePos: any = null;
    let modelBoxCache: any = null;
    let sceneCache: any = null;
    let bulbLight: any = null;
    const timers: any[] = [];
    let bug: any = null; // 引擎模块，供 tween 里构造向量用

    const parts: {
      mesh: any;
      order: number;
      quiz: { options: string[]; answerIndex: number; label: string };
      restCenter: any;
      snapRadius: number;
      size: any;
    }[] = [];

    let dragging = false;
    let pendingQuiz: { answerIndex: number } | null = null;
    let dragStartPos: any = null;
    let dragStartPoint: any = null;
    let dragPlane: any = null;
    let scoreLocal = 0;
    let solvedLocal = false;
    // 拖拽诊断，出问题时要能看到是"没抓到"还是"抓到了但没吸上"
    const diag: any = { missed: 0, grabbed: 0, offset: null, screenDist: null };
    const publishDiag = () => {
      const g = (window as any).__GAME__;
      if (g) g.diag = { ...diag };
    };

    const tween = (durationMs: number, onUpdate: (k: number) => void, onDone?: () => void) => {
      const t0 = performance.now();
      const step = (now: number) => {
        if (disposed) return;
        const raw = Math.min(1, (now - t0) / durationMs);
        onUpdate(raw);
        if (raw < 1) requestAnimationFrame(step);
        else onDone?.();
      };
      requestAnimationFrame(step);
    };

    // 细微的一声"咔哒"，不引第三方音频库
    let audioCtx: AudioContext | null = null;
    const click = () => {
      try {
        audioCtx = audioCtx || new AudioContext();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, audioCtx.currentTime + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.09);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
      } catch {
        /* 音频不可用不影响拼装 */
      }
    };

    const publish = (nextPhase: Phase) => {
      (window as any).__GAME__ = {
        id: meta.id,
        phase: nextPhase,
        score: scoreLocal,
        solved: solvedLocal,
        placed: parts.filter((p) => p.mesh.position.length() < maxSize * 0.02).length,
        total: parts.length,
        activeIndex,
        partsInfo: parts.map((p) => ({ order: p.order, label: p.quiz.label, size: p.size })),
      };
    };

    // 容器尺寸缓存：投影每帧都要用，避免每帧读布局
    let rectCache = host.getBoundingClientRect();

    const toScreen = (world: any) => {
      const rect = rectCache;
      const p = world.clone().project(camera);
      return {
        x: ((p.x + 1) / 2) * rect.width + rect.left,
        y: ((1 - p.y) / 2) * rect.height + rect.top,
      };
    };

    // 把当前零件的屏幕位置暴露给自动化测试用（不影响玩家）
    const publishActiveScreen = () => {
      if (!activeMesh) return;
      const now = (window as any).__GAME__;
      if (!now) return;
      const cur = new bug.Box3().setFromObject(activeMesh).getCenter(new bug.Vector3());
      now.activeFrom = toScreen(cur);
      now.activeTo = toScreen(parts[activeIndex].restCenter);
    };

    const showQuiz = () => {
      const part = parts[activeIndex];
      // 引擎侧自己记一份当前题目：React state 在 effect 闭包里会一直是旧值
      pendingQuiz = { answerIndex: part.quiz.answerIndex };
      setQuiz({
        options: part.quiz.options,
        answerIndex: part.quiz.answerIndex,
        partLabel: part.quiz.label,
      });
      setPhase('ask');
      publish('ask');
    };

    const finish = () => {
      setPhase('finished');
      setFeedback(null);
      publish('finished');

      // 揭晓分四拍：停半拍 → 炸开再合拢 → 镜头拉远 → 灯泡亮起
      const modelBox = modelBoxCache;
      const modelCenter = modelBox.getCenter(new bug.Vector3());
      const modelSize = modelBox.getSize(new bug.Vector3());
      const radius = (Math.max(modelSize.x, modelSize.y, modelSize.z) || 1) * 0.5;
      const dist = (radius / Math.tan((38 * Math.PI) / 180 / 2)) * 1.85;
      const dir = new bug.Vector3(0.28, 0.16, 1.0).normalize();
      const camTo = new bug.Vector3(
        modelCenter.x + dir.x * dist,
        modelCenter.y + dir.y * dist,
        modelCenter.z + dir.z * dist,
      );
      const lookAt = new bug.Vector3(modelCenter.x, modelCenter.y - modelSize.y * 0.04, modelCenter.z);
      const camFrom = camera.position.clone();

      // 第一拍：安静半拍再动
      timers.push(
        setTimeout(() => {
          const strength = maxSize * 0.42;
          tween(
            620,
            (k) => {
              const pull = Math.sin(Math.PI * easeOutCubic(k));
              for (const part of parts) {
                const c = new bug.Box3().setFromObject(part.mesh).getCenter(new bug.Vector3());
                const d = c.normalize();
                part.mesh.position.set(d.x * strength * pull, d.y * strength * pull, d.z * strength * pull);
              }
            },
            () => {
              for (const part of parts) part.mesh.position.set(0, 0, 0);
            },
          );
        }, 280),
      );

      // 第二拍：镜头缓慢拉远，让整件物体占满画面
      timers.push(
        setTimeout(() => {
          tween(700, (k) => {
            const e = easeOutCubic(k);
            camera.position.set(
              camFrom.x + (camTo.x - camFrom.x) * e,
              camFrom.y + (camTo.y - camFrom.y) * e,
              camFrom.z + (camTo.z - camFrom.z) * e,
            );
            camera.lookAt(lookAt);
          });
        }, 900),
      );

      // 第三拍：灯泡亮起——这是整个 demo 唯一有情绪的一秒
      timers.push(
        setTimeout(() => {
          if (!bulbLight) return;
          tween(420, (k) => {
            bulbLight.intensity = 3.6 * easeOutCubic(k);
          });
        }, 1600),
      );
    };

    const arrive = (index: number) => {
      activeIndex = index;
      const part = parts[index];
      part.mesh.visible = true;
      activeMesh = null; // 飞行中不可抓，落位后才交给玩家
      // 从舞台槽更外侧飞入，做出"包裹里掉出来"的感觉
      const start = new bug.Vector3(stagePos.x + maxSize * 0.55, stagePos.y + maxSize * 0.42, stagePos.z + maxSize * 0.3);
      part.mesh.position.copy(start);
      tween(
        ARRIVE_MS,
        (k) => {
          const e = easeOutCubic(k);
          part.mesh.position.set(
            start.x + (stagePos.x - start.x) * e,
            start.y + (stagePos.y - start.y) * e,
            start.z + (stagePos.z - start.z) * e,
          );
        },
        () => {
          activeMesh = part.mesh;
          setPhase('playing');
          publish('playing');
          publishActiveScreen();
        },
      );
    };

    const advance = () => {
      setQuiz(null);
      setFeedback(null);
      if (activeIndex + 1 >= parts.length) {
        setPhase('finished');
        finish();
        return;
      }
      arrive(activeIndex + 1);
    };

    const run = async () => {
      const A: any = await import('@manycore/aholo-viewer');
      bug = A;

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

      // 实测：引擎不做轴向转换，glTF 的 Y-up 原样沿用
      camera = new A.PerspectiveCamera(38, width / height, 0.01, 200);
      camera.up.set(0, 1, 0);
      viewer.setCamera(camera);

      const scene = viewer.getScene();
      // 白物体靠"暖高光 + 冷暗部"才有体积，均匀光是白膜感的来源
      scene.add(new A.AmbientLight(0x9fb0cc, 0.3));
      const key = new A.DirectionalLight(0xfff2e2, 2.2);
      key.position.set(2.6, 3.2, 2.4);
      scene.add(key);
      const fill = new A.DirectionalLight(0x8fa6cc, 0.65);
      fill.position.set(-2.2, 1.4, 2.0);
      scene.add(fill);
      const rim = new A.DirectionalLight(0xffffff, 1.1);
      rim.position.set(0.4, 1.6, -3.4);
      scene.add(rim);

      const response = await fetch(`/items/${meta.id}/model.glb`);
      if (!response.ok) throw new Error(`模型载入失败 HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const parsed = await A.GLTFLoader.loadGLTF(buffer, { textureLoader: A.downloadTexture });
      const model = parsed.scene as any;
      scene.add(model);
      model.updateMatrixWorld(true);

      // 零件 = 模型根下的 Mesh 子节点（拆分产物实测就是 N 个直接子节点）
      const meshes: any[] = [];
      model.traverse((o: any) => {
        if (o.isMesh || o.isSkinnedMesh) meshes.push(o);
      });

      const box = new A.Box3().setFromObject(model);
      modelBoxCache = box;
      const size = box.getSize(new A.Vector3());
      const center = box.getCenter(new A.Vector3());
      maxSize = Math.max(size.x, size.y, size.z) || 1;

      // meta.parts 的顺序就是到货顺序；partId 用来对齐 GLB 里的节点序号
      meta.parts.forEach((metaPart, order) => {
        const nodeIndex = Number(metaPart.partId.replace('part-', ''));
        const mesh = meshes[nodeIndex];
        if (!mesh) return;
        const restCenter = new A.Box3().setFromObject(mesh).getCenter(new A.Vector3());
        const partBox = new A.Box3().setFromObject(mesh);
        const partSize = partBox.getSize(new A.Vector3());
        const partMax = Math.max(partSize.x, partSize.y, partSize.z) || maxSize * 0.1;
        parts.push({
          mesh,
          order,
          restCenter,
          size: { x: Number(partSize.x.toFixed(3)), y: Number(partSize.y.toFixed(3)), z: Number(partSize.z.toFixed(3)) },
          // 吸合半径按零件自身大小放宽一些，大件更好放，小件不至于太苛刻
          snapRadius: Math.max(maxSize * 0.05, partMax * 0.45),
          quiz: {
            options: metaPart.options,
            answerIndex: metaPart.answerIndex,
            label: metaPart.label || metaPart.partId,
          },
        });
        // 未到货的零件藏到画面上方很远处，并且 visible=false（双保险，visible 行为未实测）
        mesh.visible = false;
        mesh.position.set(0, maxSize * 10, 0);
      });

      // 舞台槽：零件待拼的位置，放在模型右侧
      stagePos = new A.Vector3(maxSize * 1.15, 0, 0);

      // 灯泡亮起用的点光源：先以 0 强度放在灯泡原位，拼完再点亮
      const bulb = parts.find((p) => p.quiz.label === '灯泡') || parts[parts.length - 1];
      bulbLight = new A.PointLight(0xffd6a0, 0);
      bulbLight.position.set(bulb.restCenter.x, bulb.restCenter.y, bulb.restCenter.z);
      bulbLight.distance = maxSize * 3.5;
      scene.add(bulbLight);
      sceneCache = scene;

      // 取景要同时包住"拼装区"和"零件区"
      const frameMin = box.min.clone();
      const frameMax = box.max.clone();
      frameMax.x = Math.max(frameMax.x, stagePos.x + maxSize * 0.35);
      const frameCenter = frameMin.clone().add(frameMax).multiplyScalar(0.5);
      const frameSize = frameMax.clone().sub(frameMin);
      const frameRadius = Math.max(frameSize.x, frameSize.y, frameSize.z) * 0.5 || 1;
      const fovY = (38 * Math.PI) / 180;
      const distance = (frameRadius / Math.tan(fovY / 2)) * 0.95;
      const viewDir = new A.Vector3(0.55, 0.32, 1.0).normalize();
      camera.position.set(
        frameCenter.x + viewDir.x * distance,
        frameCenter.y + viewDir.y * distance,
        frameCenter.z + viewDir.z * distance,
      );
      camera.lookAt(frameCenter);
      camera.updateMatrixWorld?.(true);
      camera.updateProjectionMatrix?.();

      picker = viewer.createPicker();
      dragPlane = new A.Plane();

      // 拖动：射线在"过抓取点、法线朝相机"的平面上求交，位移量直接加给零件
      const ndcFromEvent = (event: PointerEvent) => {
        const rect = rectCache;
        return new A.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -(((event.clientY - rect.top) / rect.height) * 2 - 1),
        );
      };

      // 抓取放宽：精确拾取落空时，只要指针落在零件包围盒的投影矩形里也算抓住
      const insideProjectedBox = (mesh: any, ndc: any) => {
        const box = new A.Box3().setFromObject(mesh);
        let minX = 1e9;
        let maxX = -1e9;
        let minY = 1e9;
        let maxY = -1e9;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              const p = new A.Vector3(x, y, z).project(camera);
              minX = Math.min(minX, p.x);
              maxX = Math.max(maxX, p.x);
              minY = Math.min(minY, p.y);
              maxY = Math.max(maxY, p.y);
            }
          }
        }
        const pad = 0.03;
        return ndc.x >= minX - pad && ndc.x <= maxX + pad && ndc.y >= minY - pad && ndc.y <= maxY + pad;
      };

      const onPointerDown = (event: PointerEvent) => {
        if (!activeMesh || dragging) return;
        const ndc = ndcFromEvent(event);
        // 拾取口径实测是 NDC(-1..1)
        const hits = picker.pick(ndc, camera, true, [activeMesh]) as any[];
        const hit = hits && hits.length > 0 ? hits[0] : null;
        if (!hit && !insideProjectedBox(activeMesh, ndc)) {
          diag.missed += 1;
          publishDiag();
          return;
        }
        diag.grabbed += 1;
        publishDiag();
        const point = hit?.point
          ? hit.point.clone()
          : new A.Box3().setFromObject(activeMesh).getCenter(new A.Vector3());
        const forward = camera.getWorldDirection(new A.Vector3());
        dragPlane.setFromNormalAndCoplanarPoint(forward, point);
        dragStartPos = activeMesh.position.clone();
        dragStartPoint = point;
        dragging = true;
        host.setPointerCapture?.(event.pointerId);
        host.style.cursor = 'grabbing';
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!dragging || !activeMesh) return;
        const ndc = ndcFromEvent(event);
        picker.raycaster.setFromCamera(ndc, camera);
        const hit = picker.raycaster.ray.intersectPlane(dragPlane, new A.Vector3());
        if (!hit) return;
        const delta = hit.sub(dragStartPoint);
        activeMesh.position.set(
          dragStartPos.x + delta.x,
          dragStartPos.y + delta.y,
          dragStartPos.z + delta.z,
        );
      };

      const onPointerUp = () => {
        if (!dragging || !activeMesh) return;
        dragging = false;
        host.style.cursor = '';
        const mesh = activeMesh;
        const from = mesh.position.clone();
        const offset = from.length();
        const snapRadius = parts[activeIndex].snapRadius;

        // 除了世界坐标距离，再看一眼"视觉上是否已经对齐"：
        // 抓取点在零件边缘时，光看世界距离会误判为没放对
        const curCenter = new bug.Box3().setFromObject(mesh).getCenter(new bug.Vector3());
        const curScreen = toScreen(curCenter);
        const restScreen = toScreen(parts[activeIndex].restCenter);
        const rect = rectCache;
        const screenDist = Math.hypot(curScreen.x - restScreen.x, curScreen.y - restScreen.y);
        const screenSnap = Math.min(rect.width, rect.height) * 0.06;
        diag.offset = Number(offset.toFixed(4));
        diag.screenDist = Math.round(screenDist);
        publishDiag();

        if (offset <= snapRadius || screenDist <= screenSnap) {
          // 吸合：回弹到原位（几何烘在世界坐标里，节点归零即合体）
          setPhase('playing');
          publish('playing');
          tween(
            SNAP_MS,
            (k) => {
              const e = easeOutBack(k);
              mesh.position.set(from.x * (1 - e), from.y * (1 - e), from.z * (1 - e));
            },
            () => {
              mesh.position.set(0, 0, 0);
              activeMesh = null; // 已合体，不能再拖
              click();
              const placedNow = parts.filter((p) => p.mesh.position.length() < maxSize * 0.02).length;
              setPlaced(placedNow);
              // 已经猜对过就不再问，只继续拼
              if (solvedLocal) {
                setTimeout(advance, 160);
              } else {
                showQuiz();
              }
            },
          );
        } else {
          // 没吸上就弹回本次拖动前的位置
          tween(
            260,
            (k) => {
              const e = easeOutCubic(k);
              mesh.position.set(
                from.x + (dragStartPos.x - from.x) * e,
                from.y + (dragStartPos.y - from.y) * e,
                from.z + (dragStartPos.z - from.z) * e,
              );
            },
            () => publishActiveScreen(),
          );
        }
      };

      host.addEventListener('pointerdown', onPointerDown);
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerup', onPointerUp);
      host.addEventListener('pointercancel', onPointerUp);

      const loop = () => {
        if (disposed) return;
        model.updateMatrixWorld(true);
        // 落点指示：把当前零件的原位投影到屏幕，纯 DOM，不依赖 3D 里的线框能力
        const marker = markerRef.current;
        if (marker) {
          const part = parts[activeIndex];
          if (activeMesh && part && !dragging) {
            const s = toScreen(part.restCenter);
            marker.style.opacity = '1';
            marker.style.transform = `translate(${s.x}px, ${s.y}px)`;
          } else {
            marker.style.opacity = '0';
          }
        }
        viewer.render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);

      // 猜谜作答
      ctrlRef.current.answer = (index: number) => {
        if (!pendingQuiz) return;
        const part = parts[activeIndex];
        const k = activeIndex + 1;
        const n = parts.length;
        const correct = index === pendingQuiz.answerIndex;
        pendingQuiz = null;
        if (correct) {
          const gain = Math.round((100 * (n - k + 1)) / n);
          scoreLocal += gain;
          solvedLocal = true;
          setScore(scoreLocal);
          setSolved(true);
          setFeedback(`认出来了。+${gain}`);
        } else {
          scoreLocal = Math.max(0, scoreLocal - 10);
          setScore(scoreLocal);
          setFeedback('不是它。-10');
        }
        setQuiz(null);
        setPhase('playing');
        publish('playing');
        // 答完继续下一块，间隔留一点让反馈看得见
        setTimeout(advance, 900);
      };

      if (parts.length > 0) arrive(0);
      else throw new Error('没有可拼的零件');

      return () => {
        host.removeEventListener('pointerdown', onPointerDown);
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerup', onPointerUp);
        host.removeEventListener('pointercancel', onPointerUp);
      };
    };

    let cleanup: (() => void) | undefined;
    run()
      .then((fn) => {
        cleanup = fn;
      })
      .catch((err) => {
        setError(String(err?.message || err));
        setPhase('error');
        (window as any).__GAME__ = { id: meta.id, phase: 'error', error: String(err?.message || err) };
      });

    const onResize = () => {
      rectCache = host.getBoundingClientRect();
      viewer?.resize?.();
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      timers.forEach((t) => clearTimeout(t));
      cleanup?.();
      try {
        viewer?.destroy?.();
      } catch {
        /* 卸载失败不影响页面 */
      }
    };
  }, [meta.id, meta.parts]);

  return (
    <main style={{ position: 'relative', height: '100vh', overflow: 'hidden' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, touchAction: 'none' }} />

      {/* 落点指示：当前零件原位的屏幕投影处画一个虚线圈 */}
      <div
        ref={markerRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 46,
          height: 46,
          marginLeft: -23,
          marginTop: -23,
          borderRadius: '50%',
          border: '1px dashed rgba(255,201,138,0.42)',
          opacity: 0,
          pointerEvents: 'none',
          transition: 'opacity 160ms linear',
        }}
      />

      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(15,17,21,0.92)' }}>
          <div style={{ maxWidth: 460, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#ff8a8a', letterSpacing: 1 }}>这一件没能打开</div>
            <div style={{ fontSize: 12, color: '#8f98a8', marginTop: 10, lineHeight: 1.8 }}>{error}</div>
          </div>
        </div>
      )}

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
          <div style={{ fontSize: 11, color: '#6d7688', marginTop: 6, letterSpacing: 1 }}>
            第 {Math.min(placed + 1, meta.parts.length)} / {meta.parts.length} 块 · 得分 {score}
          </div>
        </div>
        <Track solved={solved} />
      </header>

      {/* 底部提示 */}
      {phase !== 'finished' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 26,
            textAlign: 'center',
            fontSize: 12,
            letterSpacing: 1,
            color: '#7c8698',
            pointerEvents: 'none',
          }}
        >
          {phase === 'ask' ? '先猜这一次' : '把零件拖到它该在的位置'}
        </div>
      )}

      {feedback && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '16%',
            textAlign: 'center',
            fontSize: 13,
            letterSpacing: 1,
            color: feedback.startsWith('认出') ? '#ffc98a' : '#ff9a9a',
            pointerEvents: 'none',
          }}
        >
          {feedback}
        </div>
      )}

      {/* 猜谜卡片 */}
      {quiz && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 56,
            transform: 'translateX(-50%)',
            width: 'min(560px, calc(100% - 48px))',
            background: 'rgba(18,22,29,0.92)',
            border: '1px solid #2a3140',
            padding: '18px 20px 20px',
          }}
        >
          <div style={{ fontSize: 13, color: '#e8eaf0', lineHeight: 1.9 }}>{meta.riddle}</div>
          <div style={{ fontSize: 11, color: '#6d7688', margin: '6px 0 14px', letterSpacing: 1 }}>
            寄件人说：这件东西是 ——
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {quiz.options.map((option, index) => (
              <button
                key={option}
                type="button"
                onClick={() => ctrlRef.current.answer(index)}
                style={{
                  flex: '1 1 140px',
                  border: '1px solid #333c4d',
                  background: 'rgba(28,33,43,0.9)',
                  color: '#d6dbe6',
                  fontSize: 13,
                  padding: '11px 8px',
                  borderRadius: 2,
                  cursor: 'pointer',
                  letterSpacing: 1,
                }}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 拼完 */}
      {phase === 'finished' && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 48,
            transform: 'translateX(-50%)',
            width: 'min(560px, calc(100% - 48px))',
            background: 'rgba(18,22,29,0.94)',
            border: '1px solid #2a3140',
            padding: '22px 24px',
          }}
        >
          <div style={{ fontSize: 12, color: '#6d7688', letterSpacing: 2 }}>你拼回来的是</div>
          <div style={{ fontSize: 24, margin: '6px 0 12px', letterSpacing: 2 }}>{meta.name}</div>
          <div style={{ fontSize: 12, color: '#8f98a8', lineHeight: 1.9 }}>{meta.story}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: '#ffc98a', letterSpacing: 1 }}>
              得分 {score} · {solved ? '中途认出来了' : '拼完才认出来'}
            </span>
            <a
              href={`/items/${meta.id}/export.stl`}
              download
              style={{
                fontSize: 12,
                letterSpacing: 1,
                color: '#d6dbe6',
                border: '1px solid #333c4d',
                padding: '9px 14px',
                textDecoration: 'none',
              }}
            >
              下载 STL
            </a>
            <a
              href="/"
              style={{ fontSize: 12, letterSpacing: 1, color: '#7c8698', textDecoration: 'none' }}
            >
              换一件
            </a>
          </div>
        </div>
      )}
    </main>
  );
}

function Track({ solved }: { solved: boolean }) {
  const steps = [
    { label: '图生 3D', done: true },
    { label: '拆分', done: true },
    { label: '关节', done: false },
    { label: '导出', done: true },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {steps.map((step, index) => (
        <span key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {index > 0 && <span style={{ width: 14, height: 1, background: solved ? '#2c3340' : '#242a36' }} />}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                background: step.done ? '#ffc98a' : '#39414f',
                display: 'inline-block',
              }}
            />
            <span style={{ fontSize: 10, letterSpacing: 1, color: step.done ? '#b9c1d0' : '#5d6575' }}>
              {step.label}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}
