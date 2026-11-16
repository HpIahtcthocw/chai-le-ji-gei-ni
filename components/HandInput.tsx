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
};

const PINCH_ON = 0.32;
const PINCH_OFF = 0.46;
// 只用画面中间 70% 映射到整块屏幕，手不用伸到摄像头边缘
const REACH = 0.15;

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
  const [status, setStatus] = useState('正在打开摄像头');

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
        setStatus('没有拿到摄像头权限');
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
      setStatus('正在加载手部识别');
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: '/mediapipe/hand_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      if (stopped) return;
      setStatus('把手举到摄像头前');
      loop();
    };

    let lastStamp = -1;
    const loop = () => {
      if (stopped || !landmarker) return;
      raf = requestAnimationFrame(loop);
      const video = videoRef.current!;
      if (video.readyState < 2) return;
      const now = performance.now();
      if (now === lastStamp) return;
      lastStamp = now;
      const res = landmarker.detectForVideo(video, now);
      const found = res.landmarks ?? [];
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
          if (h?.grabbed) controls?.release();
          hands[i] = undefined as unknown as HandState;
          if (el) el.style.opacity = '0';
          continue;
        }
        const size = dist(lm[0], lm[9]) || 1e-3;
        const pinchRatio = dist(lm[4], lm[8]) / size;
        const tip = toScreen({ x: (lm[4].x + lm[8].x) / 2, y: (lm[4].y + lm[8].y) / 2, z: 0, visibility: 1 });
        const prev = hands[i];
        const h: HandState = prev ?? { pinching: false, grabbed: false, x: tip.x, y: tip.y, palmX: null };
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

      setStatus(found.length ? '' : '把手举到摄像头前');
    };

    const drawDots = (all: NormalizedLandmark[][]) => {
      const cv = dotsRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d')!;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#c8402a';
      for (const lm of all) {
        for (const p of lm) {
          ctx.beginPath();
          ctx.arc((1 - p.x) * cv.width, p.y * cv.height, 2, 0, Math.PI * 2);
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
        <button type="button" className="hi-close" onClick={onClose} aria-label="关闭手势">
          ×
        </button>
      </div>
      <ul className="hi-legend">
        <li>捏住零件，往外拉</li>
        <li>张开手掌左右挥，转着看</li>
        <li>摊开以后，两只手拉开或合拢</li>
      </ul>
    </>
  );
}
