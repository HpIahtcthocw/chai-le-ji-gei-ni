'use client';

import { useEffect, useRef, useState } from 'react';
import type { HandLandmarker as HandLandmarkerType, NormalizedLandmark } from '@mediapipe/tasks-vision';

export type HandControls = {
  grab: (x: number, y: number) => boolean;
  move: (x: number, y: number) => void;
  release: () => void;
  orbit: (dx: number) => void;
  spreadBy: (d: number) => void;
};

type Props = {
  getControls: () => HandControls | undefined;
  onClose: () => void;
};

type HandState = {
  pinching: boolean;
  grabbed: boolean;
  x: number;
  y: number;
  palmX: number | null;
  seen: number;
};

// 识别偶尔掉一帧，不能让"少一帧"等于"松手"：连丢 260ms 才算手真的离开
const LOST_GRACE = 260;

const PINCH_ON = 0.32;
const PINCH_OFF = 0.46;
// 只用画面中间 70% 映射到整块屏幕，手不用伸到摄像头边缘
const REACH = 0.15;

// MediaPipe 21 点的手部骨架：连着画才看得出这是手，而不是一串散点
const HAND_LINKS: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

const dist = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y, (a.z - b.z) * 0.5);

const isOpenPalm = (lm: NormalizedLandmark[]) =>
  [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ].every(([tip, pip]) => dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.12);

export default function HandInput({ getControls, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const cursorRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const meterRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('正在打开摄像头');
  const statusRef = useRef('正在打开摄像头');
  // 每帧都 setState 会把 React 拖成瓶颈，只有文案变了才提交一次
  const say = (t: string) => {
    if (statusRef.current === t) return;
    statusRef.current = t;
    setStatus(t);
  };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarkerType | null = null;
    let raf = 0;
    const hands: HandState[] = [];
    let twoHandGap: number | null = null;

    const toScreen = (lm: NormalizedLandmark) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const nx = Math.min(1, Math.max(0, (1 - lm.x - REACH) / (1 - REACH * 2)));
      const ny = Math.min(1, Math.max(0, (lm.y - REACH) / (1 - REACH * 2)));
      return { x: nx * W, y: ny * H };
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
      } catch {
        say('没有拿到摄像头权限');
        return;
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      // 连着开关摄像头时 play() 会抛出被下一次加载打断的错误，重试一次而不是把报错丢进控制台
      try {
        await video.play();
      } catch {
        if (stopped) return;
        await new Promise((r) => setTimeout(r, 120));
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      say('正在加载手部识别');
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task', delegate },
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      try {
        landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      }
      if (stopped) return;
      say('把手举到摄像头前');
      loop();
    };

    let lastStamp = -1;
    let frozen = false;
    (window as any).__HAND_FREEZE__ = (v: boolean) => {
      frozen = v;
    };
    const loop = () => {
      if (stopped || !landmarker) return;
      raf = requestAnimationFrame(loop);
      if (frozen) return;
      const video = videoRef.current!;
      if (video.readyState < 2) return;
      const now = performance.now();
      if (now === lastStamp) return;
      lastStamp = now;
      const res = landmarker.detectForVideo(video, now);
      process(res.landmarks ?? []);
    };

    const process = (found: NormalizedLandmark[][]) => {
      const now = performance.now();
      const controls = getControls();
      drawDots(found);

      // 按屏幕横向位置给手排序，保证两只手的编号稳定
      const ordered = found
        .map((lm) => ({ lm, sx: toScreen(lm[9]).x }))
        .sort((a, b) => a.sx - b.sx)
        .map((o) => o.lm);

      for (let i = 0; i < 2; i++) {
        const lm = ordered[i];
        const el = cursorRefs[i].current;
        if (!lm) {
          const h = hands[i];
          if (h && now - h.seen > LOST_GRACE) {
            if (h.grabbed) controls?.release();
            hands[i] = undefined as unknown as HandState;
            if (el) el.style.opacity = '0';
          }
          continue;
        }
        const size = dist(lm[0], lm[9]) || 1e-3;
        const pinchRatio = dist(lm[4], lm[8]) / size;
        const tip = toScreen({ x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2, z: 0, visibility: 1 });
        const el2 = meterRef.current;
        if (el2 && i === 0) {
          el2.textContent = `掌宽 ${Math.round(size * 100)} · 捏合 ${pinchRatio.toFixed(2)} · 阈值 ${PINCH_ON}`;
        }
        const prev = hands[i];
        const h: HandState = prev ?? { pinching: false, grabbed: false, x: tip.x, y: tip.y, palmX: null, seen: now };
        h.seen = now;
        // 速度越快平滑越少：慢移稳、快移跟手
        const speed = Math.hypot(tip.x - h.x, tip.y - h.y);
        const a = Math.min(0.85, 0.25 + speed / 120);
        h.x += (tip.x - h.x) * a;
        h.y += (tip.y - h.y) * a;

        const wasPinching = h.pinching;
        h.pinching = wasPinching ? pinchRatio < PINCH_OFF : pinchRatio < PINCH_ON;
        if (h.pinching && !wasPinching && ordered.length === 1) h.grabbed = controls?.grab(h.x, h.y) ?? false;
        if (!h.pinching && wasPinching && h.grabbed) {
          controls?.release();
          h.grabbed = false;
        }
        if (ordered.length === 1) controls?.move(h.x, h.y);

        const palm = toScreen(lm[9]).x;
        if (ordered.length === 1 && !h.pinching && isOpenPalm(lm)) {
          if (h.palmX !== null) controls?.orbit(palm - h.palmX);
          h.palmX = palm;
        } else {
          h.palmX = null;
        }
        hands[i] = h;

        if (el) {
          el.style.opacity = '1';
          el.style.transform = `translate(${h.x}px, ${h.y}px)`;
          el.dataset.state = h.grabbed ? 'grab' : h.pinching ? 'pinch' : 'open';
        }
      }

      if (ordered.length === 2 && ordered.every((lm) => isOpenPalm(lm))) {
        const a = toScreen(ordered[0][9]);
        const b = toScreen(ordered[1][9]);
        const gap = Math.hypot(a.x - b.x, a.y - b.y) / window.innerWidth;
        if (twoHandGap !== null) controls?.spreadBy((gap - twoHandGap) * 2.4);
        twoHandGap = gap;
      } else {
        twoHandGap = null;
      }

      // 状态跟着手上的动作走，而不是只说「把手举起来」
      const openCount = ordered.filter((lm) => isOpenPalm(lm)).length;
      const anyGrab = hands.some((h) => h?.grabbed);
      const anyPinch = hands.some((h) => h?.pinching);
      if (!found.length) say('把手举到摄像头前');
      else if (anyGrab) say('抓住了，往外拉');
      else if (anyPinch) say('捏住了，别松手');
      else if (openCount === 2) say('两只手拉开，就摊开了');
      else if (openCount === 1) say('左右挥手，转着看');
      else say('捏住食指和拇指');
    };
    (window as any).__HAND_FEED__ = process;

    const drawDots = (all: NormalizedLandmark[][]) => {
      const cv = dotsRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = 'rgba(47,107,246,0.5)';
      ctx.lineWidth = 1;
      for (const lm of all) {
        for (const [a, b] of HAND_LINKS) {
          ctx.beginPath();
          ctx.moveTo((1 - lm[a].x) * cv.width, lm[a].y * cv.height);
          ctx.lineTo((1 - lm[b].x) * cv.width, lm[b].y * cv.height);
          ctx.stroke();
        }
      }
      ctx.fillStyle = '#2f6bf6';
      for (const lm of all) {
        for (const p of lm) {
          ctx.beginPath();
          ctx.arc((1 - p.x) * cv.width, p.y * cv.height, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // 指尖加重：真正决定捏没捏住的是食指和拇指
      ctx.fillStyle = '#1a3fb8';
      for (const lm of all) {
        for (const i of [4, 8]) {
          ctx.beginPath();
          ctx.arc((1 - lm[i].x) * cv.width, lm[i].y * cv.height, 2.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      landmarker?.close();
      stream?.getTracks().forEach((t) => t.stop());
      getControls()?.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="hi-cursor" ref={cursorRefs[0]} />
      <div className="hi-cursor" ref={cursorRefs[1]} />
      <div className="hi-cam">
        <video ref={videoRef} muted playsInline />
        <canvas ref={dotsRef} width={192} height={144} />
        {status && <div className="hi-status">{status}</div>}
        <div ref={meterRef} className="hi-meter" />
        <button type="button" className="hi-close" onClick={onClose} aria-label="关闭手势">
          ×
        </button>
      </div>
      <ul className="hi-legend">
        <li>捏住一件，往外拉</li>
        <li>张手左右挥，转着看</li>
        <li>双手拉开，就摊开</li>
      </ul>
    </>
  );
}
