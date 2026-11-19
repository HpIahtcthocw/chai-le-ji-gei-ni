'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * 拆解台：把人真的拆过的台灯放进一个能拖、能点、会自己循环拆开的舞台。
 * 台上没有假动画——拆的就是包裹码里那个 model.glb 的那几个零件，
 * 拆开时从轴心牵出细引线，像一张爆炸图。
 */
export default function HeroStage({
  src = '/items/lamp/model.glb',
  partsLabel,
  mode = 'auto',
  onUserToggle,
}: {
  src?: string;
  partsLabel?: string;
  mode?: 'auto' | 'open' | 'closed';
  onUserToggle?: (open: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  const toggleRef = useRef(onUserToggle);

  // 外部按钮能改台上这一件，台上的点击也能反过来改按钮
  useEffect(() => {
    modeRef.current = mode;
    toggleRef.current = onUserToggle;
  }, [mode, onUserToggle]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;

    const key = new THREE.DirectionalLight('#ffe6c8', 3.1);
    key.position.set(2.6, 3.6, 2.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 2.4;
    key.shadow.camera.bottom = -1.2;
    key.shadow.radius = 8;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    const rim = new THREE.DirectionalLight('#9fb6d8', 1.6);
    rim.position.set(-2.6, 1.6, -2.6);
    const fill = new THREE.PointLight('#ffcf9e', 0.8, 6);
    fill.position.set(-0.4, 0.6, 2.2);
    scene.add(key, rim, fill, new THREE.HemisphereLight('#fff4e6', '#1a1614', 0.32));

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.4 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.receiveShadow = true;
    scene.add(shadow);

    // 台面上的暖光池
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 256;
    const gctx = glowCanvas.getContext('2d');
    if (gctx) {
      const grad = gctx.createRadialGradient(128, 128, 8, 128, 128, 128);
      grad.addColorStop(0, 'rgba(255,205,150,0.55)');
      grad.addColorStop(0.45, 'rgba(255,190,130,0.16)');
      grad.addColorStop(1, 'rgba(255,180,120,0)');
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 256, 256);
    }
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 5.2),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.0015;
    scene.add(glow);

    const root = new THREE.Group();
    scene.add(root);

    type Piece = {
      mesh: THREE.Mesh;
      edges: THREE.LineSegments;
      lead: THREE.Line;
      leadGeo: THREE.BufferGeometry;
      base: THREE.Vector3;
      dir: THREE.Vector3;
      delay: number;
      hover: number;
    };
    const pieces: Piece[] = [];

    let height = 1;
    let disposed = false;
    let auto = true;
    let clickedAt = 0;
    let dragging = false;
    let lastX = 0;
    let spin = 0.06;
    let spinTarget = 0.06;
    let dragVel = 0;
    let explodeHold = 0;
    let zoom = 1;

    const pointer = new THREE.Vector2(-9, -9);
    const raycaster = new THREE.Raycaster();

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
        height = size.y * scale;
        const blast = new THREE.Vector3(0, height * 0.48, 0);

        meshes.forEach((m, index) => {
          m.geometry.applyMatrix4(fit);
          m.geometry.computeBoundingBox();
          const material = (m.material as THREE.MeshStandardMaterial).clone();
          material.side = THREE.DoubleSide;
          material.envMapIntensity = 0.75;
          const mesh = new THREE.Mesh(m.geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.partIndex = index;

          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(m.geometry, 26),
            new THREE.LineBasicMaterial({ color: '#b08a72', transparent: true, opacity: 0 }),
          );
          edges.renderOrder = 3;
          mesh.add(edges);
          root.add(mesh);

          const box = m.geometry.boundingBox!;
          const c = box.getCenter(new THREE.Vector3());
          const s = box.getSize(new THREE.Vector3());
          const radial = c.clone().sub(blast);
          if (radial.lengthSq() < 1e-6) radial.set(0, 1, 0);
          radial.normalize();
          const band = c.y / height;
          if (band > 0.6) radial.add(new THREE.Vector3(0, 0.2, 0));
          else if (band < 0.26) radial.add(new THREE.Vector3(Math.sign(c.x || 1) * 0.5, 0.12, Math.sign(c.z || 1) * 0.3));
          radial.normalize();
          // 大件走得近，小件飞得远：摊开是一层压一层的，不是炸散
          const reach = 0.2 * height + 0.16 * height * (1 - Math.min(1, Math.max(s.x, s.y, s.z) / height));
          radial.multiplyScalar(reach);
          // 少往镜头方向飞，免得糊到眼前看不清
          radial.z *= 0.55;

          // 从轴心牵到零件中心的细引线
          const leadGeo = new THREE.BufferGeometry();
          leadGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
          const lead = new THREE.Line(
            leadGeo,
            new THREE.LineBasicMaterial({ color: '#e8b39a', transparent: true, opacity: 0 }),
          );
          lead.renderOrder = 2;
          root.add(lead);

          pieces.push({
            mesh,
            edges,
            lead,
            leadGeo,
            base: mesh.position.clone(),
            dir: radial,
            delay: index * 0.05,
            hover: 0,
          });
        });
      },
      undefined,
      () => {
        if (!disposed) host.dataset.stageError = '1';
      },
    );

    const view = { dist: 3, camX: 0, camY: 0, lookX: 0, lookY: 0.3 };
    const applyCamera = (t: number) => {
      // 拆开的时候镜头自己退一点，像电影里让开位置
      camera.position.set(view.camX, view.camY + t * height * 0.06, view.dist * zoom * (1 + 0.34 * t));
      camera.lookAt(view.lookX, view.lookY + t * height * 0.05, 0);
    };

    const fitView = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const narrow = w / h < 0.95;
      view.dist = height * (narrow ? 3.95 : 2.62);
      view.camX = narrow ? 0 : height * 0.5;
      view.camY = narrow ? height * 0.56 + 0.1 : height * 0.52 + 0.16;
      view.lookX = narrow ? 0 : -height * 0.3;
      view.lookY = narrow ? height * 0.42 : height * 0.37;
      applyCamera(0);
      camera.updateProjectionMatrix();
    };
    fitView();

    const resize = new ResizeObserver(() => fitView());
    resize.observe(host);

    const active = new Map<number, { x: number; y: number }>();
    let pinchStart = 0;
    let zoomStart = 1;
    const spread = () => {
      const pts = Array.from(active.values());
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    const onPointerDown = (e: PointerEvent) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      host.setPointerCapture(e.pointerId);
      clickedAt = performance.now();
      dragVel = 0;
      if (active.size === 1) {
        dragging = true;
        lastX = e.clientX;
      } else {
        // 两指按下去就不转了，改成捏合缩放
        dragging = false;
        pinchStart = spread();
        zoomStart = zoom;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      active.delete(e.pointerId);
      if (pinchStart) {
        pinchStart = 0;
        dragVel = 0;
        clickedAt = performance.now();
        return;
      }
      if (active.size === 1) {
        // 松掉一根手指，剩下一根接着拖
        const rest = Array.from(active.values())[0];
        dragging = true;
        lastX = rest.x;
        clickedAt = performance.now();
        return;
      }
      dragging = false;
      host.releasePointerCapture?.(e.pointerId);
      const moved = Math.abs(dragVel) > 0.02 || performance.now() - clickedAt > 260;
      if (!moved) {
        const next = explodeHold > 0.5 ? 0 : 1;
        explodeHold = next;
        auto = false;
        clickedAt = performance.now();
        toggleRef.current?.(next === 1);
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (!active.has(e.pointerId)) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (active.size >= 2 && pinchStart > 4) {
        zoom = Math.min(1.9, Math.max(0.62, zoomStart * (spread() / pinchStart)));
        return;
      }
      if (dragging) {
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        root.rotation.y += dx * 0.006;
        dragVel = dx * 0.004;
        spinTarget = 0;
        auto = false;
        clickedAt = performance.now();
      }
    };
    const onPointerLeave = () => {
      pointer.set(-9, -9);
      dragging = false;
      active.clear();
      pinchStart = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = Math.min(1.9, Math.max(0.62, zoom * (1 + e.deltaY * 0.0008)));
    };
    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('wheel', onWheel, { passive: false });

    let raf = 0;
    const clock = new THREE.Clock();
    const smooth = (x: number) => x * x * (3 - 2 * x);
    const tmp = new THREE.Vector3();
    const leadFrom = new THREE.Vector3();
    const leadTo = new THREE.Vector3();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());
      const now = performance.now();

      const want = modeRef.current;
      if (want !== 'auto') {
        auto = false;
        const target = want === 'open' ? 1 : 0;
        explodeHold += (target - explodeHold) * 0.07;
      } else if (!auto && now - clickedAt > 6000 && !dragging) {
        auto = true;
        explodeHold = 0;
      }
      spin += (spinTarget - spin) * 0.06;
      if (auto) spinTarget = 0.06;
      if (!dragging) root.rotation.y += spin * dt;
      dragVel *= 0.94;

      // 慢慢拆开，停一会儿，再合回去
      const period = 10.2;
      const phase = ((now / 1000) % period) / period;
      let t: number;
      if (auto) {
        if (phase < 0.18) t = smooth(phase / 0.18);
        else if (phase < 0.62) t = 1;
        else if (phase < 0.84) t = 1 - smooth((phase - 0.62) / 0.22);
        else t = 0;
      } else {
        t = explodeHold;
      }

      applyCamera(t);

      if (pieces.length) {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(pieces.map((p) => p.mesh), false);
        const hitIndex = hits[0]?.object.userData.partIndex ?? -1;
        for (const p of pieces) {
          const want = p.mesh.userData.partIndex === hitIndex ? 1 : 0;
          p.hover += (want - p.hover) * 0.12;
        }
      }

      for (const p of pieces) {
        const local = Math.max(0, Math.min(1, (t - p.delay) / (1 - 0.05 * pieces.length || 1)));
        const e = smooth(local);
        tmp.copy(p.dir).multiplyScalar(e + p.hover * 0.22);
        p.mesh.position.copy(p.base).add(tmp);
        p.mesh.rotation.z = e * (0.05 + p.delay) * (p.dir.x > 0 ? 1 : -1);
        (p.edges.material as THREE.LineBasicMaterial).opacity = 0.12 + e * 0.4 + p.hover * 0.5;

        const pos = p.leadGeo.getAttribute('position') as THREE.BufferAttribute;
        leadFrom.set(0, height * 0.48, 0);
        leadTo.copy(p.base).add(tmp);
        pos.setXYZ(0, leadFrom.x, leadFrom.y, leadFrom.z);
        pos.setXYZ(1, leadTo.x, leadTo.y, leadTo.z);
        pos.needsUpdate = true;
        (p.lead.material as THREE.LineBasicMaterial).opacity = e * 0.18;

        const mat = p.mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.setRGB(0.12, 0.05, 0.03);
        mat.emissiveIntensity = e * 0.14 + p.hover * 0.3;
      }

      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('wheel', onWheel);
      renderer.dispose();
      pmrem.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
  }, [src]);

  return <div ref={hostRef} className="hero-stage" data-parts={partsLabel ?? ''} />;
}
