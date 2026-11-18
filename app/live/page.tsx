'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

/**
 * 线上现生成：不落盘、不排队等分钟级任务。
 * 拍照 → 提交生成（拿任务号）→ 每 3 秒查一次 → 提交拆件 → 再查 → 出一条包裹链接。
 * 每个请求都是秒级，所以 serverless 扛得住。
 */
const MAX_EDGE = 1600;

type Stage = 'idle' | 'gen' | 'split' | 'done' | 'error';
type Phase = 'pending' | 'running' | 'done' | 'failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toDataUrl(file: File): Promise<{ dataUrl: string; width: number; height: number; kb: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  if (!bitmap) throw new Error('这张图浏览器读不出来，换一张 JPG / PNG 再试');
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.drawImage(bitmap, 0, 0, width, height);

  // 4.5MB 是函数请求体的上限，压到 2MB 以内才稳
  for (const q of [0.8, 0.65, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const kb = Math.round((dataUrl.length * 3) / 4 / 1024);
    if (dataUrl.length < 2_600_000) return { dataUrl, width, height, kb };
  }
  throw new Error('这张图压不下去，换一张小一点的照片');
}

const PHASE_TEXT: Record<Phase, string> = {
  pending: '排队中',
  running: '在做',
  done: '好了',
  failed: '失败',
};

export default function LivePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [img, setImg] = useState<{ dataUrl: string; width: number; height: number; kb: number } | null>(null);
  const [sender, setSender] = useState('');
  const [line, setLine] = useState('');
  const [genPhase, setGenPhase] = useState<Phase | null>(null);
  const [splitPhase, setSplitPhase] = useState<Phase | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');

  const busy = stage === 'gen' || stage === 'split';

  const pick = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('这不是图片');
      setStage('error');
      return;
    }
    setError('');
    try {
      const out = await toDataUrl(file);
      setImg(out);
      setStage('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : '读图失败');
      setStage('error');
    }
  }, []);

  const run = useCallback(async () => {
    if (!img || busy) return;
    setStage('gen');
    setError('');
    setLink('');
    setGenPhase('pending');
    setSplitPhase(null);
    setSeconds(0);

    const startedAt = Date.now();
    const ticker = window.setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);

    try {
      const genRes = await fetch('/api/gen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ img: img.dataUrl }),
      });
      const genJson = (await genRes.json()) as { taskId?: number; error?: string };
      if (!genRes.ok || !genJson.taskId) throw new Error(genJson.error || `提交失败 ${genRes.status}`);

      // 单件建模实测 5-10 分钟，留足 12 分钟的窗口
      let glbUrl = '';
      for (let i = 0; i < 240; i++) {
        await sleep(3000);
        const r = await fetch(`/api/gen?id=${genJson.taskId}`);
        const j = (await r.json()) as { phase?: Phase; glbUrl?: string | null; error?: string };
        if (!r.ok) throw new Error(j.error || `查询失败 ${r.status}`);
        setGenPhase(j.phase ?? 'pending');
        if (j.phase === 'failed') throw new Error('生成没跑通，换一张照片再试');
        if (j.phase === 'done' && j.glbUrl) {
          glbUrl = j.glbUrl;
          break;
        }
      }
      if (!glbUrl) throw new Error('生成超时了，几分钟还没出结果');

      setStage('split');
      setSplitPhase('pending');
      const splitRes = await fetch('/api/split', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ glbUrl }),
      });
      const splitJson = (await splitRes.json()) as { taskId?: number; error?: string };
      if (!splitRes.ok || !splitJson.taskId) throw new Error(splitJson.error || `拆件提交失败 ${splitRes.status}`);

      let splitUrl = '';
      for (let i = 0; i < 200; i++) {
        await sleep(3000);
        const r = await fetch(`/api/split?id=${splitJson.taskId}`);
        const j = (await r.json()) as { phase?: Phase; glbUrl?: string | null; error?: string };
        if (!r.ok) throw new Error(j.error || `查询失败 ${r.status}`);
        setSplitPhase(j.phase ?? 'pending');
        if (j.phase === 'failed') throw new Error('拆件没跑通（有些东西拆不开）');
        if (j.phase === 'done' && j.glbUrl) {
          splitUrl = j.glbUrl;
          break;
        }
      }
      if (!splitUrl) throw new Error('拆件超时了');

      const parcelRes = await fetch('/api/parcel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ u: splitUrl, sender: sender.trim(), line: line.trim() }),
      });
      const parcelJson = (await parcelRes.json()) as { url?: string; error?: string };
      if (!parcelRes.ok || !parcelJson.url) throw new Error(parcelJson.error || '打包失败');

      setLink(parcelJson.url);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了');
      setStage('error');
    } finally {
      window.clearInterval(ticker);
    }
  }, [img, busy, sender, line]);

  return (
    <main className="send-page">
      <div className="send-inner">
        <div className="send-top">
          <Link href="/" className="send-back">← 回到门口</Link>
        </div>

        <h1 className="send-title">拍一件<br />你愿意拆开的东西</h1>
        <p className="send-lead">
          照片会先长成一块粗模，再被拆成零件。<br />
          这件事要几分钟，不用守着，链接出来就能发给人。
        </p>

        <button
          type="button"
          className={busy ? 'send-drop is-busy' : 'send-drop'}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {img ? (
            <img src={img.dataUrl} alt="待寄出的照片" className="send-preview" />
          ) : (
            <span className="send-drop-hint">点击选择照片，或用手机拍一张</span>
          )}
          {img && !busy && <span className="send-drop-repick">换一张</span>}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pick(file);
            e.target.value = '';
          }}
        />

        <div className="send-status">
          {img && (
            <span className="send-status-meta">
              {img.width}×{img.height} · {img.kb} KB · 已压成 JPEG
            </span>
          )}
          {error && <span className="send-status-text is-error">{error}</span>}
        </div>

        {(genPhase || splitPhase) && (
          <ol className="send-steps">
            <li>
              <span>建模</span>
              <em>{genPhase ? PHASE_TEXT[genPhase] : '等'}</em>
            </li>
            <li>
              <span>拆成零件</span>
              <em>{splitPhase ? PHASE_TEXT[splitPhase] : '没开始'}</em>
            </li>
            <li>
              <span>装盒出链接</span>
              <em>{stage === 'done' ? '好了' : stage === 'split' || stage === 'gen' ? '等前两步' : '没开始'}</em>
            </li>
            {busy && <li className="is-clock">{seconds}s</li>}
          </ol>
        )}

        {stage === 'done' && link && (
          <div className="send-url">
            <div className="send-url-label">装好了。这条链接就是那个盒子。</div>
            <a className="send-url-value" href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
            <div className="send-live-actions">
              <a className="send-next" href={link}>拆开它</a>
              <button
                type="button"
                className="send-copy"
                onClick={() => navigator.clipboard?.writeText(link)}
              >
                复制链接
              </button>
            </div>
          </div>
        )}

        <label className="send-sign">
          <span>署名</span>
          <input
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder="不写也行，收件人猜不到是谁寄的"
            maxLength={12}
          />
        </label>

        <label className="send-line">
          <span>那句话（必须写）</span>
          <textarea
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="他拆到最后一块，才会看到这句。"
            maxLength={80}
            rows={3}
          />
          <em>{line.length}/80</em>
        </label>

        <div className="send-foot">
          <div className="send-note">生成期间可以离开，回来刷新还在这页。</div>
          <button type="button" className="send-next" disabled={!img || busy || !line.trim()} onClick={() => void run()}>
            {stage === 'gen' ? '正在建模…' : stage === 'split' ? '正在拆件…' : stage === 'done' ? '再寄一件' : '让它长出来'}
          </button>
        </div>
      </div>
    </main>
  );
}
