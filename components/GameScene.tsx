'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ItemMeta } from '@/lib/items';

// 一块一块到货：拼上的零件留在原位，未到的零件藏在画面外。
// 猜谜按"第 k 块猜中得 round(100 × (N−k+1)/N)"记分，猜错扣 10 分（最低 10）。

type Phase = 'loading' | 'sealed' | 'opening' | 'playing' | 'ask' | 'finished' | 'error';

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
  const [narrow, setNarrow] = useState(false);
  const [loadPct, setLoadPct] = useState<number | null>(null);
  const [loadBytes, setLoadBytes] = useState<{ got: number; total: number } | null>(null);
  const [burst, setBurst] = useState(false);
  const burstedRef = useRef(false);

  // 引擎侧的可变状态放 ref，避免 React 重渲染打断动画
  const ctrlRef = useRef<{ answer: (index: number) => void; unpack: () => void }>({ answer: () => {}, unpack: () => {} });
  const markerRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onViewport = () => setNarrow(window.innerWidth < 680);
    onViewport();
    window.addEventListener('resize', onViewport);
    return () => window.removeEventListener('resize', onViewport);
  }, []);

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
    // 程序化铰链：灯杆顶端做支点，灯臂/灯头/灯罩/灯泡绕它转
    let hingeWorld: any = null;
    let headParts: any[] = [];
    let bulbLocal: any = null;
    let headGroupReady = false;
    const timers: any[] = [];
    let bug: any = null; // 引擎模块，供 tween 里构造向量用

    const parts: {
      mesh: any;
      order: number;
      quiz: { options: string[]; answerIndex: number; label: string };
      restCenter: any;
      snapRadius: number;
      size: any;
      snapped?: boolean;
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
        // 头部零件挂到铰链支点后 position 不再是 0，所以用快照标记计数
        placed: parts.filter((p) => p.snapped).length,
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
      // 竖屏同样要按水平视野算一次，否则拉远后左右两侧还是被裁
      const fovY = (38 * Math.PI) / 180;
      const aspect = (camera as any).aspect || 16 / 9;
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
      const fitHorizontal = modelSize.x / 2 / Math.tan(fovX / 2);
      const dist = Math.max((radius / Math.tan(fovY / 2)) * 1.85, fitHorizontal * 1.85);
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

      // 炸开结束时所有零件 position 已归零，抬臂从这里起步

      // 第三拍：抬臂。灯杆顶端当铰链，头部四块绕 Z 轴抬 19°：
      // 对"烘在世界坐标"的几何来说，绕 h 旋转等价于 rotation.z = a 且 position = h − R·h
      timers.push(
        setTimeout(() => {
          if (!headGroupReady || !hingeWorld || headParts.length === 0) return;
          const angle = 0.34;
          const axis = new bug.Vector3(0, 0, 1);
          tween(700, (k) => {
            const a = angle * easeOutCubic(k);
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            for (const part of headParts) {
              // 引擎的局部矩阵是 position + quaternion 合成的，改 rotation.z 不生效，
              // 必须走 setRotationFromAxisAngle；改完再用 setMatrixDirty 通知渲染桥
              part.mesh.setRotationFromAxisAngle?.(axis, a);
              part.mesh.position.set(
                hingeWorld.x - (cos * hingeWorld.x - sin * hingeWorld.y),
                hingeWorld.y - (sin * hingeWorld.x + cos * hingeWorld.y),
                0,
              );
              part.mesh.setMatrixDirty?.();
            }
            // 点光源在灯泡里，得跟着灯罩一起转，否则光会从灯罩里跑出来
            if (bulbLight && bulbLocal) {
              bulbLight.position.set(
                hingeWorld.x + bulbLocal.x * cos - bulbLocal.y * sin,
                hingeWorld.y + bulbLocal.x * sin + bulbLocal.y * cos,
                hingeWorld.z + bulbLocal.z,
              );
              bulbLight.setMatrixDirty?.();
            }
          });
        }, 1650),
      );

      // 第四拍：灯泡亮起——这是整个 demo 唯一有情绪的一秒
      timers.push(
        setTimeout(() => {
          if (!bulbLight) return;
          tween(420, (k) => {
            bulbLight.intensity = 3.6 * easeOutCubic(k);
          });
        }, 2400),
      );
    };

    const arrive = (index: number) => {
      activeIndex = index;
      const part = parts[index];
      part.mesh.visible = true;
      activeMesh = null; // 飞行中不可抓，落位后才交给玩家
      // 几何烘在世界坐标里，position 是"相对原位的偏移"，不是绝对坐标。
      // 这里保持"所有零件用同一个偏移"的口径，视觉上零件都从同一个槽位飞入；
      // 不同零件因自身高度不同会略微错开，但都在取景范围内
      const target = new bug.Vector3(stagePos.x, stagePos.y, stagePos.z);
      // 从槽位更外侧飞入，做出"包裹里掉出来"的感觉
      const start = target.clone().add(new bug.Vector3(maxSize * 0.55, maxSize * 0.42, maxSize * 0.3));
      part.mesh.position.copy(start);
      tween(
        ARRIVE_MS,
        (k) => {
          const e = easeOutBack(k);
          part.mesh.position.set(
            start.x + (target.x - start.x) * e,
            start.y + (target.y - start.y) * e,
            start.z + (target.z - start.z) * e,
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

      // 16 MB 模型下载期间必须有真实进度，否则玩家以为点了没反应。
      // 从入口页客户端跳转进来时，偶发一次 ERR_CACHE_WRITE_FAILURE（缓存后端抖动），
      // 所以这里带一次退避重试，真实网络抖动也能兜住
      const loadBuffer = (attempt: number) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', `/items/${meta.id}/model.glb${attempt > 0 ? `?retry=${attempt}` : ''}`);
          xhr.responseType = 'arraybuffer';
          let lastPct = -1;
          xhr.onprogress = (event) => {
            if (disposed) return;
            const total = event.lengthComputable ? event.total : 0;
            if (!total) return;
            const pct = Math.min(1, event.loaded / total);
            if (pct - lastPct >= 0.01 || pct >= 1) {
              lastPct = pct;
              setLoadPct(pct);
              setLoadBytes({ got: event.loaded, total });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as ArrayBuffer);
            else reject(new Error(`模型载入失败 HTTP ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error('模型载入失败：网络中断'));
          xhr.send();
        });

      const buffer = await loadBuffer(0).catch(async (first: Error) => {
        if (disposed) throw first;
        setLoadPct(null);
        setLoadBytes(null);
        await new Promise((r) => setTimeout(r, 320));
        return loadBuffer(1);
      });
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
            options: metaPart.options ?? [],
            answerIndex: metaPart.answerIndex ?? 0,
            label: metaPart.label || metaPart.partId,
          },
        });
        // 未到货的零件藏到画面上方很远处，并且 visible=false（双保险，visible 行为未实测）
        mesh.visible = false;
        mesh.position.set(0, maxSize * 10, 0);
      });

      // 舞台槽：零件待拼的位置，放在模型右侧。竖屏也不改位置——
      // 试过移到上方，会和"几何烘在世界坐标"的偏移口径打架，高的零件被顶出画面
      stagePos = new A.Vector3(maxSize * 1.15, 0, 0);

      // 灯泡亮起用的点光源：先以 0 强度放在灯泡原位，拼完再点亮
      const bulb = parts.find((p) => p.quiz.label === '灯泡') || parts[parts.length - 1];
      bulbLight = new A.PointLight(0xffd6a0, 0);
      bulbLight.position.set(bulb.restCenter.x, bulb.restCenter.y, bulb.restCenter.z);
      bulbLight.distance = maxSize * 3.5;
      scene.add(bulbLight);

      // 铰链支点放在灯杆顶端。不新建父节点（场景级父节点的世界矩阵不会每帧刷新，
      // 实测会把零件甩出画面），改成逐块算"绕支点旋转"的等价局部变换
      const headLabels = ['灯臂', '灯头接头', '灯罩', '灯泡'];
      headParts = parts.filter((p) => headLabels.includes(p.quiz.label));
      const polePart = parts.find((p) => p.quiz.label === '灯杆');
      if (headParts.length > 0 && polePart) {
        // 必须用落位前的 rest 数据：此刻灯杆还被藏在 maxSize*10 的场外，
        // 直接量包围盒会量到一个 4.9 米高的假铰链
        hingeWorld = new A.Vector3(
          polePart.restCenter.x,
          polePart.restCenter.y + polePart.size.y / 2,
          polePart.restCenter.z,
        );
        bulbLocal = new A.Vector3(
          bulbLight.position.x - hingeWorld.x,
          bulbLight.position.y - hingeWorld.y,
          bulbLight.position.z - hingeWorld.z,
        );
        headGroupReady = true;
      }
      sceneCache = scene;

      // 取景要同时包住"拼装区"和"零件区"。
      // 竖屏的水平视野比垂直窄，只按垂直视野算距离会把左右两侧裁掉，
      // 所以垂直、水平各算一个距离，取大的
      const frameMin = box.min.clone();
      const frameMax = box.max.clone();
      frameMax.x = Math.max(frameMax.x, stagePos.x + maxSize * 0.3);
      frameMax.y = Math.max(frameMax.y, stagePos.y + maxSize * 0.3);
      const frameCenter = frameMin.clone().add(frameMax).multiplyScalar(0.5);
      const frameSize = frameMax.clone().sub(frameMin);
      const frameRadius = Math.max(frameSize.x, frameSize.y, frameSize.z) * 0.5 || 1;
      const fovY = (38 * Math.PI) / 180;
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * (width / height));
      const fitHorizontal = frameSize.x / 2 / Math.tan(fovX / 2);
      // 桌面端沿用原来的垂直取景，只有竖屏水平视野不够时才把相机往外推
      const distance = Math.max((frameRadius / Math.tan(fovY / 2)) * 0.82, fitHorizontal * 1.02);
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
              // 吸合瞬间在落点闪一圈，手感靠这个反馈立住
              const flash = flashRef.current;
              if (flash) {
                const spot = toScreen(parts[activeIndex].restCenter);
                flash.style.left = `${spot.x}px`;
                flash.style.top = `${spot.y}px`;
                flash.classList.remove('is-on');
                void flash.offsetWidth;
                flash.classList.add('is-on');
              }
              parts[activeIndex].snapped = true;
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

      if (!parts.length) throw new Error('没有可拼的零件');

      // 开场不让玩家直接干活：先给一只封着的包裹，拆开才开始到货
      setPhase('sealed');
      publish('sealed');
      let unpacked = false;
      ctrlRef.current.unpack = () => {
        if (unpacked || disposed) return;
        unpacked = true;
        click();
        setBurst(true);
        setTimeout(() => setBurst(false), 1000);
        setPhase('opening');
        publish('opening');
        arrive(0);
      };

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

      {/* 开场：一只封着的包裹，拆开才开始到货 */}
      {phase === 'sealed' && (
        <div className="sealed-layer">
          <div className="parcel" aria-hidden="true">
            <span className="parcel-tape" />
            <span className="parcel-label">给：你</span>
          </div>
          <div className="sealed-copy">有人把它拆成零件寄过来了</div>
          <div className="sealed-sub">
            {meta.parts.length} 个零件 · 寄件人没有写名字，只留了这一句：{meta.riddle}
          </div>
          <button
            type="button"
            data-action="unpack"
            className="sealed-btn"
            onClick={() => ctrlRef.current.unpack()}
          >
            拆 开
          </button>
        </div>
      )}

      {/* 开场炸包：纸屑一圈炸开，接住拆包那一拍 */}
      {burst && <ParcelBurst />}

      {/* 暗角：把纯黑视口压成有中心光的舞台，物体不像浮在虚空里 */}
      <div className="stage-vignette" aria-hidden="true" />
      <div className="stage-glow" aria-hidden="true" />
      {/* 图纸角标：细线 L 角，几乎不花成本但能把整体气质拉到"工程图" */}
      <div className="corners" aria-hidden="true">
        <i className="tl" />
        <i className="tr" />
        <i className="bl" />
        <i className="br" />
      </div>

      {/* 加载态：16 MB 模型下载期间必须有明确进度，否则看起来像点击没反应 */}
      {phase === 'loading' && (
        <div className="loader">
          <div className="loader-label">正在拆包</div>
          <div className="loader-bar">
            {loadPct === null ? (
              <div className="loader-fill loader-fill--idle" />
            ) : (
              <div className="loader-fill" style={{ width: `${Math.round(loadPct * 100)}%` }} />
            )}
          </div>
          <div className="loader-note">
            {loadBytes
              ? `${(loadBytes.got / 1048576).toFixed(1)} / ${(loadBytes.total / 1048576).toFixed(1)} MB`
              : '读取模型'}
          </div>
          <div className="loader-riddle">寄件人没有写名字，只留了这一句：{meta.riddle}</div>
        </div>
      )}

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
          display: 'grid',
          placeItems: 'center',
          fontSize: 11,
          letterSpacing: 1,
          color: 'rgba(255,201,138,0.55)',
        }}
      >
        {String(Math.min(placed + 1, meta.parts.length)).padStart(2, '0')}
      </div>

      {/* 吸合闪光环，位置由引擎在吸合瞬间写入 */}
      <div ref={flashRef} className="flash-ring" aria-hidden="true" />

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
          padding: narrow ? '14px 14px' : '20px 24px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          pointerEvents: 'none',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: narrow ? 14 : 15, letterSpacing: 2, color: '#e8eaf0', whiteSpace: 'nowrap' }}>
            无名件
          </div>
          <div style={{ fontSize: 11, color: '#6d7688', marginTop: 6, letterSpacing: 1, whiteSpace: 'nowrap' }}>
            第 {Math.min(placed + 1, meta.parts.length)} / {meta.parts.length} 块 · 得分 {score}
          </div>
        </div>
        <Track placed={placed} total={meta.parts.length} compact={narrow} />
      </header>

      {/* 底部提示 */}
      {(phase === 'playing' || phase === 'ask') && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: narrow ? 10 : 26,
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

      {/* 猜谜卡片：窄屏改成底部抽屉，拇指够得着 */}
      {quiz && (
        <div
          className={narrow ? 'card-sheet' : 'card-center'}
          style={{
            position: 'absolute',
            left: narrow ? 0 : '50%',
            right: narrow ? 0 : 'auto',
            bottom: narrow ? 0 : 56,
            transform: narrow ? 'none' : 'translateX(-50%)',
            width: narrow ? 'auto' : 'min(560px, calc(100% - 48px))',
            background: 'rgba(18,22,29,0.96)',
            border: '1px solid #2a3140',
            borderLeft: narrow ? 'none' : '1px solid #2a3140',
            borderRight: narrow ? 'none' : '1px solid #2a3140',
            borderBottom: narrow ? 'none' : '1px solid #2a3140',
            borderRadius: narrow ? '14px 14px 0 0' : 0,
            padding: narrow ? '16px 16px calc(18px + env(safe-area-inset-bottom))' : '18px 20px 20px',
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
                className="opt"
                onClick={() => ctrlRef.current.answer(index)}
                style={{
                  flex: narrow ? '1 1 100%' : '1 1 140px',
                  border: '1px solid #333c4d',
                  background: 'rgba(28,33,43,0.9)',
                  color: '#d6dbe6',
                  fontSize: narrow ? 15 : 13,
                  padding: narrow ? '15px 8px' : '11px 8px',
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
          className={narrow ? 'card-sheet' : 'card-center'}
          style={{
            position: 'absolute',
            left: narrow ? 0 : '50%',
            right: narrow ? 0 : 'auto',
            bottom: narrow ? 0 : 48,
            transform: narrow ? 'none' : 'translateX(-50%)',
            width: narrow ? 'auto' : 'min(560px, calc(100% - 48px))',
            background: 'rgba(18,22,29,0.96)',
            border: '1px solid #2a3140',
            borderLeft: narrow ? 'none' : '1px solid #2a3140',
            borderRight: narrow ? 'none' : '1px solid #2a3140',
            borderBottom: narrow ? 'none' : '1px solid #2a3140',
            borderRadius: narrow ? '14px 14px 0 0' : 0,
            padding: narrow ? '18px 16px calc(20px + env(safe-area-inset-bottom))' : '22px 24px',
          }}
        >
          <div style={{ fontSize: 12, color: '#6d7688', letterSpacing: 2 }}>你拼回来的是</div>
          <div style={{ fontSize: narrow ? 21 : 24, margin: '6px 0 12px', letterSpacing: 2 }}>{meta.name}</div>
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

/** 只表示"到货了几块"，不暴露任何制作流程 */
function Track({ placed, total, compact = false }: { placed: number; total: number; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 5 : 7, flexShrink: 0 }}>
      {Array.from({ length: total }, (_, index) => {
        const on = index < placed;
        return (
          <span
            key={index}
            style={{
              width: compact ? 5 : 6,
              height: compact ? 5 : 6,
              borderRadius: 6,
              background: on ? '#ffc98a' : 'rgba(255,255,255,0.16)',
              display: 'inline-block',
            }}
          />
        );
      })}
    </div>
  );
}

/** 开场纸屑：纯 DOM + CSS 变量，不依赖 3D 能力 */
function ParcelBurst() {
  const shards = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.12 : -0.1);
    const distance = 150 + (i % 4) * 46;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance * 0.72,
      rot: (i % 2 ? 1 : -1) * (90 + i * 12),
      delay: (i % 6) * 24,
    };
  });
  return (
    <div className="burst" aria-hidden="true">
      {shards.map((item, index) => (
        <i
          key={index}
          style={
            {
              '--dx': `${item.dx}px`,
              '--dy': `${item.dy}px`,
              '--rot': `${item.rot}deg`,
              animationDelay: `${item.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}