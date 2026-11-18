'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import HandInput, { type HandControls } from './HandInput';

(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
];
const RIM_BLOCK = new THREE.Color('#c8402a');
const RIM_HOVER = new THREE.Color('#111214');
const RIM_CORE = new THREE.Color('#e8902f');
const INK = new THREE.Color('#34322e');
const RISO = ['#c8402a', '#24408e', '#e0a21a', '#2f6b4f', '#d77a8b', '#5b4ea0', '#1d1d1f'].map((c) => new THREE.Color(c));
export type Finish = 'ink' | 'raw' | 'riso' | 'line';
const FINISH_NAME: Record<Finish, string> = { ink: '墨色', raw: '原色', riso: '套色', line: '线框' };

/** 放大 2.2% 的菲涅尔壳层：只描边缘，不改零件本身的贴图（做法来自 CTViewer） */
const RIM_VERT = `
  varying vec3 vN; varying vec3 vV;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const RIM_FRAG = `
  uniform vec3 uColor; uniform float uIntensity;
  varying vec3 vN; varying vec3 vV;
  void main(){
    float ndv = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
    float rim = smoothstep(0.62, 0.04, ndv);
    float a = pow(rim, 0.9) * uIntensity;
    gl_FragColor = vec4(uColor, a);
  }`;

type Part = {
  index: number;
  mesh: THREE.Mesh;
  rim: THREE.ShaderMaterial;
  rimTarget: number;
  center: THREE.Vector3;
  boxSize: THREE.Vector3;
  size: number;
  removed: boolean;
  free: THREE.Vector3[];
  blockers: Set<number>;
  radial: THREE.Vector3;
  cell: THREE.Vector3;
  label?: string;
  bestDir?: THREE.Vector3;
};

type Phase = 'loading' | 'playing' | 'note' | 'spread';

type Props = {
  src: string;
  sender: string;
  itemName: string;
  message: string;
  labels: Record<number, string>;
  /** 寄件人原图：核心零件被拉出时浮出来，和 3D 件并排 */
  photo?: string;
  /** 有包裹码时才给“回一句”的入口 */
  replyCode?: string;
};

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const easeInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOutExpo = (k: number) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
const easeOutBack = (k: number) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

export default function LockProto({ src, sender, itemName, message, labels, photo, replyCode }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [progress, setProgress] = useState(0);
  const [removed, setRemoved] = useState(0);
  const [total, setTotal] = useState(0);
  const [hint, setHint] = useState<string | null>('按住一块往外拉 · 被压着的拆不动');
  const [finish, setFinish] = useState<Finish>('ink');
  const [spreadDone, setSpreadDone] = useState(false);
  const [coreLabel, setCoreLabel] = useState('最里面');
  // 拆完给一句账：拆了几块、硬拽几次、用了多久，收件人自己会拿去对比
  const [elapsed, setElapsed] = useState<number | null>(null);
  // 上一次拆同一件的成绩，存在本机：拆得快一点、少拽一次，都值得被记着
  const [record, setRecord] = useState<string | null>(null);
  const damageRef = useRef(0);
  const startRef = useRef(0);
  const ctrlRef = useRef<{
    spread: () => void;
    fold: () => void;
    finish: (f: Finish) => void;
    resize: () => void;
    hand?: HandControls;
  }>({ spread: () => {}, fold: () => {}, finish: () => {}, resize: () => {} });
  const [handsOn, setHandsOn] = useState(false);
  /** 硬拉被压住的件、朝错方向拽，都会在件上留下撬痕；纸条能否读全看这个 */
  const [damage, setDamage] = useState(0);
  const [oldest, setOldest] = useState<string | null>(null);
  const dirsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const tagsHost = tagsRef.current;
    if (!host || !tagsHost) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.85;

    const camera = new THREE.PerspectiveCamera(30, host.clientWidth / host.clientHeight, 0.01, 60);
    camera.position.set(1.7, 1.15, 2.35);
    // 开场那一套取景：按「装好之后的包围盒」算，不受托盘散落位置影响
    const openingPose = () => {
      const box = new THREE.Box3();
      parts.forEach((part) => {
        if (part.mesh.geometry.boundingBox) box.union(part.mesh.geometry.boundingBox);
      });
      const size = box.getSize(new THREE.Vector3());
      const r = size.length() * 0.5;
      const fovY = THREE.MathUtils.degToRad(camera.fov);
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
      const dist = Math.max(r / Math.sin(fovY / 2), r / Math.sin(fovX / 2)) * 0.95;
      const target = box.getCenter(new THREE.Vector3());
      const dir = new THREE.Vector3(1.7, 1.15, 2.35).normalize();
      return { pos: target.clone().addScaledVector(dir, Math.max(controls.minDistance, dist)), target };
    };

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.46, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = Math.PI * 0.49;

    const key = new THREE.DirectionalLight('#fff3e2', 2.6);
    key.position.set(1.8, 3.0, 1.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2.4;
    key.shadow.camera.right = 2.4;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -2.4;
    key.shadow.radius = 5;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    const rimLight = new THREE.DirectionalLight('#c9d6ea', 1.4);
    rimLight.position.set(-2.4, 1.6, -2.2);
    scene.add(key, rimLight, new THREE.HemisphereLight('#ffffff', '#b8b2a6', 0.5));

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.2 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const root = new THREE.Group();
    scene.add(root);
    const parts: Part[] = [];

    // ---- 声音：咔哒音阶 + 卡住的闷响 + 纸条的沙沙声 ----
    let audio: AudioContext | null = null;
    const ctx = () => (audio = audio || new AudioContext());
    const tone = (freq: number, type: OscillatorType, dur: number, peak: number) => {
      try {
        const a = ctx();
        const osc = a.createOscillator();
        const gain = a.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, a.currentTime);
        gain.gain.exponentialRampToValueAtTime(peak, a.currentTime + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
        osc.connect(gain).connect(a.destination);
        osc.start();
        osc.stop(a.currentTime + dur + 0.02);
      } catch {
        /* 没有音频设备 */
      }
    };
    const rustle = () => {
      try {
        const a = ctx();
        const len = Math.floor(a.sampleRate * 0.45);
        const buf = a.createBuffer(1, len, a.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2) * (0.5 + 0.5 * Math.sin(i / 900));
        const srcNode = a.createBufferSource();
        const filter = a.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2400;
        const gain = a.createGain();
        gain.gain.value = 0.16;
        srcNode.buffer = buf;
        srcNode.connect(filter).connect(gain).connect(a.destination);
        srcNode.start();
      } catch {
        /* 没有音频设备 */
      }
    };
    const SCALE = [523, 587, 659, 784, 880, 988, 1047, 1175, 1319, 1397];
    const clickUp = (n: number) => tone(SCALE[Math.min(n, SCALE.length - 1)], 'triangle', 0.1, 0.11);
    const thud = () => tone(92, 'sine', 0.2, 0.3);

    const originals: { m: THREE.MeshStandardMaterial; color: THREE.Color; rough: number; metal: number; map: THREE.Texture | null }[] = [];
    const edgeOverlays = new Map<number, THREE.LineSegments>();
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x0f1319, transparent: true, opacity: 0.92 });
    const applyFinish = (f: Finish) => {
      originals.forEach((o, i) => {
        if (f !== 'line' && o.m.map !== o.map) {
          o.m.map = o.map;
          o.m.needsUpdate = true;
        }
        if (f === 'raw') {
          o.m.color.copy(o.color);
          o.m.roughness = o.rough;
          o.m.metalness = o.metal;
        } else if (f === 'ink') {
          o.m.color.copy(o.color).multiply(INK);
          o.m.roughness = Math.max(o.rough, 0.5);
          o.m.metalness = o.metal;
        } else if (f === 'riso') {
          o.m.color.copy(o.color).multiply(RISO[i % RISO.length]);
          o.m.roughness = Math.max(o.rough, 0.5);
          o.m.metalness = o.metal;
        } else {
          // 线框态：物件退成白模，只留结构线，像 Aholo 主视觉里那种发光骨架
          o.m.color.set('#fcfdfe');
          o.m.roughness = 0.92;
          o.m.metalness = 0.02;
          // 贴图里烤着原来的木纹和锈斑，白模要它干净，所以先摘掉
          o.m.map = null;
          o.m.needsUpdate = true;
        }
      });
      parts.forEach((p) => {
        if (f === 'line') {
          let seg = edgeOverlays.get(p.index);
          if (!seg) {
            // 30° 折角才留线：够干净，也不会把 27 万面全画成网
            const edges = new THREE.EdgesGeometry(p.mesh.geometry, 30);
            seg = new THREE.LineSegments(edges, edgeMat);
            seg.raycast = () => {};
            seg.renderOrder = 1;
            p.mesh.add(seg);
            edgeOverlays.set(p.index, seg);
          }
          seg.visible = true;
        } else {
          const seg = edgeOverlays.get(p.index);
          if (seg) seg.visible = false;
        }
      });
    };
    ctrlRef.current.finish = applyFinish;

    // ---- 补间 ----
    const tweens: { t0: number; dur: number; step: (k: number) => void; done?: () => void }[] = [];
    const tween = (dur: number, step: (k: number) => void, done?: () => void, delay = 0) =>
      tweens.push({ t0: performance.now() + delay, dur, step, done });

    const raycaster = new THREE.Raycaster();
    (raycaster as any).firstHitOnly = true;

    /** 沿六个轴向从零件顶点打射线，打到别的零件就算这个方向被挡住 */
    const computeFreedom = () => {
      const alive = parts.filter((p) => !p.removed);
      for (const part of alive) {
        part.free = [];
        part.blockers = new Set();
        const pos = part.mesh.geometry.attributes.position as THREE.BufferAttribute;
        const stride = Math.max(1, Math.floor(pos.count / 260));
        const others = alive.filter((o) => o !== part).map((o) => o.mesh);
        const v = new THREE.Vector3();
        let bestDir: THREE.Vector3 | null = null;
        let bestHits = Infinity;
        for (const axis of AXES) {
          let hits = 0;
          let samples = 0;
          const hitBy = new Map<number, number>();
          for (let i = 0; i < pos.count; i += stride) {
            v.fromBufferAttribute(pos, i).addScaledVector(axis, 0.003);
            raycaster.set(v, axis);
            raycaster.far = 3;
            const hit = raycaster.intersectObjects(others, false)[0];
            samples++;
            if (hit) {
              hits++;
              const idx = hit.object.userData.partIndex as number;
              hitBy.set(idx, (hitBy.get(idx) || 0) + 1);
            }
          }
          const throughFloor = axis.y < -0.5 && part.center.y - part.boxSize.y * 0.5 < 0.02;
          const blocked = throughFloor || hits > Math.max(2, samples * 0.02);
          if (!blocked) part.free.push(axis.clone());
          else hitBy.forEach((n, idx) => n > 1 && part.blockers.add(idx));
          if (!throughFloor && hits < bestHits) {
            bestHits = hits;
            bestDir = axis;
          }
        }
        (part as any).bestDir = bestDir;
        (part as any).bestHits = bestHits;
      }
      if (alive.length && alive.every((p) => p.free.length === 0)) {
        const loosest = alive.reduce((a, b) => ((a as any).bestHits <= (b as any).bestHits ? a : b));
        loosest.free = [((loosest as any).bestDir as THREE.Vector3).clone()];
      }
    };

    const measureDepth = () => {
      let rounds = 0;
      while (parts.some((p) => !p.removed) && rounds < 20) {
        computeFreedom();
        parts.filter((p) => !p.removed && p.free.length > 0).forEach((p) => (p.removed = true));
        rounds++;
      }
      parts.forEach((p) => (p.removed = false));
      computeFreedom();
      return rounds;
    };

    /** 货架装箱：按高度排序，逐行塞进目标宽度（human-atlas 的 explosion-layout 思路），返回每格中心 */
    const shelfLayout = (aspect: number) => {
      const pad = 0.09;
      const cards = parts.map((p) => ({ p, w: p.boxSize.x + pad, h: p.boxSize.y + pad }));
      const area = cards.reduce((n, c) => n + c.w * c.h, 0);
      const maxW = Math.max(...cards.map((c) => c.w));
      const targetW = Math.max(maxW, Math.sqrt(area * Math.max(0.7, Math.min(2.2, aspect))) * 1.12);
      cards.sort((a, b) => b.h - a.h);
      let x = 0;
      let y = 0;
      let row = 0;
      let usedW = 0;
      const raw: { p: Part; x: number; y: number }[] = [];
      for (const c of cards) {
        if (x > 0 && x + c.w > targetW) {
          x = 0;
          y += row;
          row = 0;
        }
        raw.push({ p: c.p, x: x + c.w / 2, y: y + c.h / 2 });
        x += c.w;
        usedW = Math.max(usedW, x);
        row = Math.max(row, c.h);
      }
      const height = y + row;
      const lift = 0.12;
      for (const r of raw) r.p.cell.set(r.x - usedW / 2, height - r.y + lift, 0);
      return { width: usedW, height: height + lift };
    };

    let coreIndex = -1;
    let maxPartSize = 1;
    let itemHeight = 1;
    let shelf = { width: 1, height: 1 };

    const loader = new GLTFLoader();
    loader.load(
      src,
      (gltf) => {
        if (disposed) return;
        const meshes: THREE.Mesh[] = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
        const all = new THREE.Box3();
        for (const m of meshes) {
          m.geometry = m.geometry.clone();
          m.geometry.applyMatrix4(m.matrixWorld);
          m.geometry.computeBoundingBox();
          all.union(m.geometry.boundingBox!);
        }
        const size = all.getSize(new THREE.Vector3());
        const scale = 1 / Math.max(size.x, size.y, size.z);
        const center = all.getCenter(new THREE.Vector3());
        const fit = new THREE.Matrix4()
          .makeScale(scale, scale, scale)
          .multiply(new THREE.Matrix4().makeTranslation(-center.x, -all.min.y, -center.z));
        const height = size.y * scale;
        itemHeight = height;
        // 放射中心取整体 45% 高度，而不是几何中心：底座和灯头才会往相反方向走
        const blastCenter = new THREE.Vector3(0, height * 0.45, 0);

        meshes.forEach((m, index) => {
          m.geometry.applyMatrix4(fit);
          m.geometry.computeBoundingBox();
          (m.geometry as any).computeBoundsTree();
          const material = (m.material as THREE.MeshStandardMaterial).clone();
          material.side = THREE.DoubleSide;
          material.envMapIntensity = 1;
          originals.push({ m: material, color: material.color.clone(), rough: material.roughness, metal: material.metalness, map: material.map });
          const mesh = new THREE.Mesh(m.geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.partIndex = index;

          const rim = new THREE.ShaderMaterial({
            uniforms: { uColor: { value: RIM_HOVER.clone() }, uIntensity: { value: 0 } },
            vertexShader: RIM_VERT,
            fragmentShader: RIM_FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
          const box = m.geometry.boundingBox!;
          const c = box.getCenter(new THREE.Vector3());
          const shell = new THREE.Mesh(m.geometry, rim);
          // 壳层绕零件自身中心放大，而不是绕世界原点
          shell.position.copy(c).multiplyScalar(-0.022);
          shell.scale.setScalar(1.022);
          shell.raycast = () => {};
          shell.renderOrder = 2;
          mesh.add(shell);
          root.add(mesh);

          const s = box.getSize(new THREE.Vector3());
          const radial = c.clone().sub(blastCenter);
          if (radial.lengthSq() < 1e-6) radial.set(0, 1, 0);
          radial.normalize();
          // 分组偏置：上半部往上走，贴地的往两侧走，避免挤成一团
          const band = c.y / height;
          if (band > 0.62) radial.add(new THREE.Vector3(0, 0.55, 0));
          else if (band < 0.22) radial.add(new THREE.Vector3(Math.sign(c.x || 1) * 0.6, 0.1, Math.sign(c.z || 1) * 0.4));
          radial.normalize();

          parts.push({
            index,
            mesh,
            rim,
            rimTarget: 0,
            center: c,
            boxSize: s,
            size: Math.max(s.x, s.y, s.z),
            removed: false,
            free: [],
            blockers: new Set(),
            radial,
            cell: new THREE.Vector3(),
            label: labels[index],
          });
        });

        maxPartSize = parts.reduce((m, p) => Math.max(m, p.size), 0.001);
        applyFinish('ink');
        computeFreedom();
        const initialFree = parts.map((p) => p.free.length);
        coreIndex = parts.reduce((best, p) => (p.free.length < parts[best].free.length ? p.index : best), 0);
        const depth = measureDepth();
        shelf = shelfLayout(camera.aspect);
        buildTags();
        (window as any).__PROTO__ = { parts: parts.length, coreIndex, initialFree, depth };
        // 验收用：把某一块按它的松脱方向真的拉到台面上
        (window as any).__PROTO_PULL__ = (index?: number) => {
          const i = typeof index === 'number' ? index : coreIndex;
          const part = parts[i];
          if (!part) return false;
          removePart(part, part.free[0] ?? new THREE.Vector3(0, 1, 0));
          return true;
        };
        (window as any).__PROTO_HURT__ = (n = 2) => {
          damageRef.current = n;
          setDamage(n);
          return n;
        };
        (window as any).__PROTO_NOTE__ = () => {
          parts.forEach((p) => (p.removed = true));
          setRemoved(parts.length);
          setHint(null);
          setPhase('note');
        };

        setCoreLabel(labels[coreIndex] ?? `第 ${coreIndex + 1} 块`);
        setTotal(parts.length);
        startRef.current = Date.now();
        setPhase('playing');
      },
      (e) => {
        if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
      },
    );

    // ---- 货架上的编号标签 ----
    const tagEls: HTMLDivElement[] = [];
    const buildTags = () => {
      tagsHost.innerHTML = '';
      parts.forEach((p, i) => {
        const el = document.createElement('div');
        el.className = 'lp-tag';
        const isCore = p.index === coreIndex;
        const isOld = p.index === oldestIdx;
        el.innerHTML = `<i></i><span class="lp-tag-no">${String(i + 1).padStart(2, '0')}</span><span class="lp-tag-name">${
          p.label ?? `第 ${p.index + 1} 块`
        }${isCore ? '<em>纸条在这里</em>' : ''}${isOld ? '<em>最旧的一块</em>' : ''}</span>`;
        tagsHost.appendChild(el);
        tagEls.push(el);
      });
    };

    const project = (p: THREE.Vector3) => {
      const v = p.clone().project(camera);
      return new THREE.Vector2((v.x + 1) * 0.5 * host.clientWidth, (1 - v.y) * 0.5 * host.clientHeight);
    };

    // ---- 拆：只沿畅通方向做一维移动 ----
    const pointer = new THREE.Vector2();
    let drag: {
      part: Part;
      startX: number;
      startY: number;
      axis: THREE.Vector3 | null;
      screenDir: THREE.Vector2;
      pxPerUnit: number;
    } | null = null;
    let hovered: Part | null = null;
    // 悬停时画出这件能脱开的方向：让玩家用眼睛判断，而不是靠六向乱试
    const dirEls: HTMLDivElement[] = [];
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.className = 'lp-dir';
      el.style.opacity = '0';
      dirsRef.current?.appendChild(el);
      dirEls.push(el);
    }
    const hideDirs = () => dirEls.forEach((el) => (el.style.opacity = '0'));
    const showDirs = (part: Part) => {
      const axes = part.free.length > 0 ? part.free.slice(0, 3) : part.bestDir ? [part.bestDir] : [];
      const base = part.center.clone().add(part.mesh.position);
      const c = project(base);
      axes.forEach((axis, i) => {
        const el = dirEls[i];
        if (!el) return;
        const tip = project(base.clone().addScaledVector(axis, 0.22));
        const dx = tip.x - c.x;
        const dy = tip.y - c.y;
        const len = Math.hypot(dx, dy);
        if (len < 6) {
          el.style.opacity = '0';
          return;
        }
        const reach = Math.min(64, Math.max(38, len * 1.6));
        const ux = dx / len;
        const uy = dy / len;
        el.style.left = `${c.x + ux * 14}px`;
        el.style.top = `${c.y + uy * 14}px`;
        el.style.width = `${reach}px`;
        el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        el.style.opacity = '1';
      });
      for (let i = axes.length; i < dirEls.length; i++) dirEls[i].style.opacity = '0';
    };
    let jiggle: { part: Part; t0: number } | null = null;
    let removedCount = 0;
    let finished = false;
    let trayX = -0.62;
    let trayRow = 0;
    let hintCleared = false;
    let oldestIdx = -1;

    const ndcFrom = (x: number, y: number) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    };
    const pickAt = (x: number, y: number, pad = 44) => {
      ndcFrom(x, y);
      raycaster.setFromCamera(pointer, camera);
      raycaster.far = Infinity;
      const hit = raycaster.intersectObjects(parts.filter((p) => !p.removed).map((p) => p.mesh), false)[0];
      if (hit) return parts[hit.object.userData.partIndex as number];
      // 细杆、线缆这类零件太细，点不准就按屏幕距离取最近的一块（44px 内）
      const r = renderer.domElement.getBoundingClientRect();
      const px = x - r.left;
      const py = y - r.top;
      let best: Part | null = null;
      let bestD = pad;
      for (const part of parts) {
        if (part.removed) continue;
        const c = project(part.center.clone().add(part.mesh.position));
        const d = Math.hypot(c.x - px, c.y - py);
        if (d < bestD) {
          bestD = d;
          best = part;
        }
      }
      return best;
    };

    const tries = new Map<number, number>();
    const flashBlockers = (part: Part) => {
      thud();
      jiggle = { part, t0: performance.now() };
      const blockers = [...part.blockers].map((i) => parts[i]).filter((p) => p && !p.removed);
      blockers.forEach((b) => {
        b.rim.uniforms.uColor.value.copy(RIM_BLOCK);
        b.rimTarget = 1;
      });
      const names = blockers.map((b) => (b.label ? b.label : `第 ${b.index + 1} 块`));
      const n = (tries.get(part.index) ?? 0) + 1;
      tries.set(part.index, n);
      // 头两次只给看得见的线索，第三次才告诉你是谁压着：难度靠理顺序，不靠记答案
      const text =
        names.length === 0
          ? '卡住了'
          : n < 3
            ? '被旁边的件卡着'
            : names.length === 1
              ? `先拆${names[0]}`
              : `先拆${names.slice(0, 2).join('、')}`;
      setHint(text);
      damageRef.current += 1;
      setDamage(damageRef.current);
      setTimeout(() => {
        blockers.forEach((b) => (b.rimTarget = 0));
        setHint(null);
      }, 900);
    };

    const trayTarget = (part: Part) => {
      const w = part.boxSize.x;
      if (trayX - w < -1.45) {
        trayRow++;
        trayX = -0.62;
      }
      const x = trayX - w / 2;
      trayX -= w + 0.08;
      const target = new THREE.Vector3(x, 0, 0.35 - trayRow * 0.5).sub(part.center);
      target.y = -part.mesh.geometry.boundingBox!.min.y + 0.002;
      return target;
    };

    /** 双轴取大：把台面上所有零件框进画面，方位保持用户当前视角 */
    let camGoal: { target: THREE.Vector3; dist: number } | null = null;
    const reframe = () => {
      if (spreadArmed) return;
      const box = new THREE.Box3();
      parts.forEach((p) => box.expandByObject(p.mesh));
      const size = box.getSize(new THREE.Vector3());
      const fovY = THREE.MathUtils.degToRad(camera.fov);
      const fovX = 2 * Math.atan(Math.tan(fovY / 2) * camera.aspect);
      const r = size.length() * 0.5;
      const dist = Math.max(r / Math.sin(fovY / 2), r / Math.sin(fovX / 2)) * 0.95;
      const target = box.getCenter(new THREE.Vector3());
      target.y = Math.min(target.y, 0.46);
      camGoal = { target, dist: Math.max(controls.minDistance, dist) };
    };

    const removePart = (part: Part, axis: THREE.Vector3) => {
      part.removed = true;
      removedCount++;
      clickUp(removedCount);
      setRemoved(removedCount);
      part.rimTarget = 0;
      const start = part.mesh.position.clone();
      const lift = start.clone().addScaledVector(axis, 0.12);
      lift.y += 0.2;
      const target = trayTarget(part);
      tween(560, (k) => {
        const e = easeOutExpo(k);
        const a = start.clone().lerp(lift, Math.min(1, e * 1.8));
        part.mesh.position.copy(a.lerp(target, e));
      });
      computeFreedom();
      setTimeout(reframe, 380);
      oldestIdx = part.index;
      setOldest(part.label ?? '最后拆下来的那件');
      if (part.index === coreIndex) {
        finished = true;
        const sec = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
        setElapsed(sec);
        const hurtNow = damageRef.current;
        const key = `wuming:best:${src}`;
        let line = '';
        try {
          const raw = window.localStorage.getItem(key);
          const prev = raw ? (JSON.parse(raw) as { sec?: number; damage?: number }) : null;
          if (prev && typeof prev.sec === 'number') {
            if (sec < prev.sec) line = `比上次快 ${prev.sec - sec} 秒`;
            else if (typeof prev.damage === 'number' && hurtNow < prev.damage) {
              line = `比上次少硬拽 ${prev.damage - hurtNow} 次`;
            } else line = `上次 ${prev.sec} 秒`;
            if (hurtNow === 0 && prev.damage === 0) line += ' · 两次纸边都没缺';
          } else {
            line = '第一次拆完';
          }
          const better =
            !prev ||
            typeof prev.sec !== 'number' ||
            sec <= prev.sec ||
            (typeof prev.damage === 'number' && hurtNow < prev.damage);
          if (better) window.localStorage.setItem(key, JSON.stringify({ sec, damage: hurtNow }));
        } catch {
          line = '';
        }
        setRecord(line || null);
        part.rim.uniforms.uColor.value.copy(RIM_CORE);
        part.rimTarget = 1;
        setHint(null);
        setTimeout(() => {
          rustle();
          setPhase('note');
        }, 620);
      }
    };

    const grabAt = (x: number, y: number, pad = 44) => {
      if (finished) return false;
      const part = pickAt(x, y, pad);
      if (!part) return false;
      controls.enabled = false;
      drag = { part, startX: x, startY: y, axis: null, screenDir: new THREE.Vector2(), pxPerUnit: 1 };
      return true;
    };

    const onDown = (e: PointerEvent) => {
      if (grabAt(e.clientX, e.clientY)) renderer.domElement.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => moveTo(e.clientX, e.clientY);

    const moveTo = (x: number, y: number) => {
      if (!drag) {
        if (finished) return;
        const p = pickAt(x, y);
        if (p !== hovered) {
          if (hovered && hovered.rim.uniforms.uColor.value.equals(RIM_HOVER)) hovered.rimTarget = 0;
          hovered = p;
          if (p && p.rimTarget === 0) {
            p.rim.uniforms.uColor.value.copy(RIM_HOVER);
            p.rimTarget = 0.55;
          }
          renderer.domElement.style.cursor = p ? 'grab' : '';
        }
        return;
      }
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (!drag.axis) {
        if (Math.hypot(dx, dy) < 12) return;
        if (drag.part.free.length === 0) {
          flashBlockers(drag.part);
          drag = null;
          return;
        }
        const c = project(drag.part.center);
        let best = -Infinity;
        for (const axis of drag.part.free) {
          const tip = project(drag.part.center.clone().addScaledVector(axis, 0.2));
          const sd = tip.clone().sub(c);
          const len = sd.length();
          if (len < 4) continue;
          const score = (sd.x * dx + sd.y * dy) / (len * Math.hypot(dx, dy));
          if (score > best) {
            best = score;
            drag.axis = axis;
            drag.screenDir = sd.clone().divideScalar(len);
            drag.pxPerUnit = len / 0.2;
          }
        }
        if (!drag.axis || best < 0.28) {
          // 被拉的方向挡着，但它在别的方向是松的：只抖不报挡路的零件
          thud();
          jiggle = { part: drag.part, t0: performance.now() };
          setHint('顺着箭头的方向拔');
          damageRef.current += 1;
      setDamage(damageRef.current);
          setTimeout(() => setHint(null), 900);
          drag = null;
          return;
        }
        renderer.domElement.style.cursor = 'grabbing';
        if (!hintCleared) {
          hintCleared = true;
          setHint(null);
        }
      }
      const along = Math.max(0, (dx * drag.screenDir.x + dy * drag.screenDir.y) / drag.pxPerUnit);
      // 越拉越吃力：前段跟手，后段有阻尼
      const eased = along < 0.08 ? along : 0.08 + (along - 0.08) * 0.75;
      drag.part.mesh.position.copy(drag.axis!).multiplyScalar(eased);
      if (along * drag.pxPerUnit > 150 || along > drag.part.size * 0.9 + 0.06) {
        const { part, axis } = drag;
        drag = null;
        removePart(part, axis!);
      }
    };

    const onUp = () => {
      controls.enabled = true;
      renderer.domElement.style.cursor = '';
      if (!drag) return;
      const { part } = drag;
      const from = part.mesh.position.clone();
      drag = null;
      tween(260, (k) => part.mesh.position.copy(from).multiplyScalar(1 - easeOutBack(k)));
    };

    /** 手势输入：捏合等同按住，张开的单手横扫转视角，双手拉开 / 合拢控制摊开程度 */
    const orbitBy = (dx: number) => {
      if (drag || spreadArmed) return;
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.006);
      camera.position.copy(controls.target).add(offset);
      camGoal = null;
    };
    ctrlRef.current.hand = {
      grab: grabAt,
      move: moveTo,
      release: onUp,
      orbit: orbitBy,
      spreadBy: (d: number) => {
        if (spreadArmed) spreadTarget = clamp01(spreadTarget + d);
      },
    };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);

    // ---- 摊开：先合拢 → 放射炸开 → 码进货架；进度带阻尼，可用滚轮来回拨 ----
    let spread = 0;
    let spreadTarget = 0;
    let spreadArmed = false;
    let orbitPose = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    const frontPose = () => {
      const fovY = THREE.MathUtils.degToRad(camera.fov);
      const usableH = shelf.height * 1.28;
      const usableW = shelf.width * 1.18;
      // 双轴取大：宽高谁更紧按谁算距离，旋转和换屏都不会出画
      const dist = Math.max(usableH, usableW / camera.aspect) / (2 * Math.tan(fovY / 2));
      const target = new THREE.Vector3(0, shelf.height * 0.5 + 0.02, 0);
      return { pos: target.clone().add(new THREE.Vector3(0, 0.08, dist)), target };
    };

    const applySpread = (p: number) => {
      const t = clamp01(p);
      const k = easeInOut(clamp01((t - 0.1) / 0.62));
      // 合拢前最后一点：整体轻轻一“咔”，才像是装回去
      const pulse = t < 0.12 ? Math.sin((t / 0.12) * Math.PI) * 0.03 : 0;
      parts.forEach((part, i) => {
        // 不是所有零件同时炸开：从底座往上依次离开，再落到台面上各自的格位
        const wave = clamp01(part.center.y / Math.max(0.001, itemHeight)) * 0.24;
        const raw = clamp01((t * 1.2 - wave) / 0.86);
        const e = easeInOut(raw);
        const end = part.cell.clone().sub(part.center);
        // 控制点抬高再落：像有人把零件端起来、放到桌面上，而不是炸飞
        const ctrl = new THREE.Vector3(end.x * 0.32, 0.5 + 0.06, end.z * 0.32 + 0.22);
        const w0 = (1 - e) * (1 - e);
        const w1 = 2 * (1 - e) * e;
        const w2 = e * e;
        part.mesh.position.set(
          w1 * ctrl.x + w2 * end.x,
          w1 * ctrl.y + w2 * end.y,
          w1 * ctrl.z + w2 * end.z,
        );
        const flight = Math.sin(e * Math.PI);
        part.mesh.rotation.y = flight * 0.16 * (i % 2 ? 1 : -1);
        part.mesh.rotation.x = flight * 0.05 * (i % 2 ? -1 : 1);
        part.mesh.scale.setScalar(1 + pulse);
      });
      const f = frontPose();
      camera.position.copy(orbitPose.pos).lerp(f.pos, k);
      controls.target.copy(orbitPose.target).lerp(f.target, k);
      camera.lookAt(controls.target);
      ground.material.opacity = 0.2 * (1 - easeInOut(clamp01((t - 0.3) / 0.5)) * 0.7);
    };
    ctrlRef.current.spread = () => {
      setPhase('spread');
      buildTags();
      parts.forEach((p) => (p.rimTarget = 0));
      controls.enabled = false;
      // 先把托盘里的零件按装配顺序装回原位，再炸开
      const order = [...parts].sort((a, b) => a.center.y - b.center.y);
      order.forEach((p, i) => {
        const from = p.mesh.position.clone();
        tween(
          420,
          (k) => {
            const e = easeOutBack(k);
            p.mesh.position.copy(from).multiplyScalar(1 - e);
            p.mesh.rotation.y *= 1 - k;
          },
          () => clickUp(i),
          i * 90,
        );
      });
      const settle = order.length * 90 + 520;
      setTimeout(() => {
        tone(174, 'sine', 0.35, 0.28);
        camGoal = null;
        orbitPose = openingPose();
        shelf = shelfLayout(camera.aspect);
        spread = 0;
        spreadTarget = 1;
        spreadArmed = true;
      }, settle);
    };
    ctrlRef.current.fold = () => {
      spreadTarget = spreadTarget > 0.5 ? 0 : 1;
    };

    const onWheel = (e: WheelEvent) => {
      if (!spreadArmed) return;
      e.preventDefault();
      spreadTarget = clamp01(spreadTarget + e.deltaY * 0.0012);
    };
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    (window as any).__PROTO_API__ = {
      pick: (x: number, y: number) => pickAt(x, y)?.index ?? -1,
      phase: () => (finished ? 'done' : 'playing'),
      spread: () => spread,
      openSpread: () => ctrlRef.current.spread(),
      setSpread: (v: number) => (spreadTarget = clamp01(v)),
      hand: ctrlRef.current.hand,
      state: () =>
        parts.map((p) => {
          const c = project(p.center.clone().add(p.mesh.position));
          const r = renderer.domElement.getBoundingClientRect();
          return {
            index: p.index,
            removed: p.removed,
            x: Math.round(c.x + r.left),
            y: Math.round(c.y + r.top),
            free: p.free.map((d) => {
              const tip = project(p.center.clone().addScaledVector(d, 0.2));
              return { dx: Math.round(tip.x - c.x), dy: Math.round(tip.y - c.y) };
            }),
          };
        }),
    };


    const onResize = () => {
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
      if (spreadArmed) shelf = shelfLayout(camera.aspect);
    };
    window.addEventListener('resize', onResize);

    let last = performance.now();
    let reportedDone = false;
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (let i = tweens.length - 1; i >= 0; i--) {
        const t = tweens[i];
        if (now < t.t0) continue;
        const k = Math.min(1, (now - t.t0) / t.dur);
        t.step(k);
        if (k >= 1) {
          tweens.splice(i, 1);
          t.done?.();
        }
      }
      if (jiggle) {
        const t = (now - jiggle.t0) / 1000;
        if (t > 0.34) {
          jiggle.part.mesh.position.set(0, 0, 0);
          jiggle = null;
        } else {
          const amp = 0.014 * (1 - t / 0.34);
          jiggle.part.mesh.position.set(Math.sin(t * 74) * amp, 0, Math.cos(t * 58) * amp * 0.5);
        }
      }
      const focus = drag?.part ?? hovered;
      if (focus && !focus.removed && phase !== 'note') showDirs(focus);
      else hideDirs();

      // 一进来不知道该干嘛：让唯一能拆的那块轻轻呼吸，手指就知道往哪放
      if (removedCount === 0 && !drag && !hovered) {
        const cue = parts.find((part) => !part.removed && part.free.length > 0);
        if (cue) {
          cue.rim.uniforms.uColor.value.copy(RIM_HOVER);
          cue.rimTarget = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(now / 620));
        }
      }
      for (const p of parts) {
        const u = p.rim.uniforms.uIntensity;
        u.value = THREE.MathUtils.damp(u.value, p.rimTarget, 12, dt);
      }
      if (spreadArmed) {
        spread = THREE.MathUtils.damp(spread, spreadTarget, 6.4, dt);
        applySpread(spread);
        const show = clamp01((spread - 0.62) / 0.16);
        parts.forEach((p, i) => {
          const el = tagsHost.children[i] as HTMLElement | undefined;
          if (!el) return;
          const anchor = p.center.clone().add(p.mesh.position);
          anchor.y -= p.boxSize.y / 2 + 0.035;
          const s = project(anchor);
          el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, 0)`;
          el.style.opacity = String(show);
        });
        const done = spread > 0.97;
        if (done !== reportedDone) {
          reportedDone = done;
          setSpreadDone(done);
        }
      } else {
        if (camGoal && !drag) {
          const dir = camera.position.clone().sub(controls.target).normalize();
          controls.target.lerp(camGoal.target, 1 - Math.exp(-4 * dt));
          const d = THREE.MathUtils.damp(camera.position.distanceTo(controls.target), camGoal.dist, 4, dt);
          camera.position.copy(controls.target).addScaledVector(dir, d);
          if (Math.abs(d - camGoal.dist) < 0.005 && controls.target.distanceTo(camGoal.target) < 0.005) camGoal = null;
        }
        controls.update();
      }
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      pmrem.dispose();
      host.removeChild(renderer.domElement);
      tagsHost.innerHTML = '';
    };
  }, [src, labels]);

  // 撬得越狠，纸条缺得越多：最多只剩前半句
  const cutRatio = Math.min(0.5, damage * 0.09);
  const kept = Math.max(6, Math.round(message.length * (1 - cutRatio)));
  const torn = `${message.slice(0, kept)}…（下半张被撕掉了）`;

  // 纸条一出现，就把 3D 舞台收高 36%：主体在上面，纸条躺在前景，谁也不压谁
  useEffect(() => {
    if (phase !== 'note') return;
    const t = window.setTimeout(() => ctrlRef.current.resize(), 80);
    return () => window.clearTimeout(t);
  }, [phase]);

  return (
    <main className="lp" data-phase={phase} data-note={phase === 'note' ? '1' : '0'}>
      <div ref={hostRef} className="lp-stage" />
      <div ref={dirsRef} className="lp-dirs" aria-hidden="true" />
      <div className="lp-dots" aria-hidden="true" />
      <div ref={tagsRef} className="lp-tags" aria-hidden="true" />
      <div className="lp-mark">Aholo Viewer 渲染 · Lux3D 生成</div>

      <div className="lp-rule lp-rule-top">
        <span>
          {sender} 寄来一件东西
        </span>
        <span className="lp-rule-right">
          {total > 0 && (
            <span className="lp-count">
              已拆 {removed} / {total}
            </span>
          )}
          {damage > 0 && (
            <span className="lp-worn" title="硬拽留下的撬痕，会撕坏里面的纸条">
              撬痕 {damage}
            </span>
          )}
          <button type="button" className={handsOn ? 'lp-hands is-on' : 'lp-hands'} onClick={() => setHandsOn((v) => !v)}>
            {handsOn ? '关闭手势' : '用手势'}
          </button>
          <span className="lp-finish">
            {(Object.keys(FINISH_NAME) as Finish[]).map((f) => (
              <button
                key={f}
                type="button"
                className={f === finish ? 'is-on' : undefined}
                onClick={() => {
                  setFinish(f);
                  ctrlRef.current.finish(f);
                }}
              >
                {FINISH_NAME[f]}
              </button>
            ))}
          </span>
        </span>
      </div>

      {handsOn && <HandInput getControls={() => ctrlRef.current.hand} onClose={() => setHandsOn(false)} />}

      {phase === 'loading' && <div className="lp-loading">拆包中 {progress ? `${progress}%` : ''}</div>}
      {phase === 'playing' && hint && <div className="lp-hint">{hint}</div>}


      {phase === 'note' && (
        <div className="lp-note">
          {photo && (
            // 原图不做成卡片（白底物件会变成一块白板），压在纸下面当纸的底纹
            <div className="lp-note-ghost" style={{ backgroundImage: `url(${photo})` }} aria-hidden />
          )}
          <div className="lp-note-body-wrap">
            <div className="lp-note-head">{coreLabel}里夹着一张纸条</div>
            <p className="lp-note-body">{damage > 0 ? torn : message}</p>
            {damage > 0 && (
              <p className="lp-note-worn">
                撬坏 {damage} 处，纸边连字一起掉了。
                <button type="button" onClick={() => window.location.reload()}>
                  重新拆一次
                </button>
              </p>
            )}
            {oldest && (
              <p className="lp-note-answer">
                最旧的一块：<b>{oldest}</b>
              </p>
            )}
            <div className="lp-note-sign">
              {sender}
              {photo ? ' · 照片和这句话一起封进去的' : ''}
            </div>
            {elapsed !== null && (
              <p className="lp-note-stat">
                拆了 {total} 块 · 硬拽 {damage} 次 · 用了 {elapsed} 秒
                {record ? ` · ${record}` : ''}
              </p>
            )}
            <div className="lp-note-actions">
              <button type="button" className="lp-cta" onClick={() => ctrlRef.current.spread()}>
                全部摊开
              </button>
              {replyCode && (
                <a className="lp-cta lp-cta-line" href={`/r/${encodeURIComponent(replyCode)}`}>
                  回他一句
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {phase === 'spread' && (
        <div className="lp-rule lp-rule-bottom">
          <span>{spreadDone ? `${itemName}，共 ${total} 件` : '滚轮能来回拨'}</span>
          <span className="lp-spread-actions">
            <button type="button" className="lp-cta lp-cta-line" onClick={() => setPhase('note')}>
              再看纸条
            </button>
            {replyCode && (
              <a className="lp-cta lp-cta-line" href={`/r/${encodeURIComponent(replyCode)}`}>
                回他一句
              </a>
            )}
            <button type="button" className="lp-cta lp-cta-line" onClick={() => ctrlRef.current.fold()}>
              {spreadDone ? '装回去' : '摊开'}
            </button>
            <a className="lp-door" href="/">
              门口
            </a>
          </span>
        </div>
      )}
    </main>
  );
}
