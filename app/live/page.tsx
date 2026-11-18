'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';

/**
 * 寄件台：一件东西从照片变成可拆的包裹。
 * 无状态链路——提交拿任务号，浏览器每 3 秒查一次，模型地址编进包裹链接。
 */
const MAX_EDGE = 1600;

type Stage = 'idle' | 'gen' | 'split' | 'done' | 'error';
type Phase = 'pending' | 'running' | 'done' | 'failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PHASE_TEXT: Record<Phase, string> = {
  pending: '排着队',
  running: '正在做',
  done: '好了',
  failed: '没做成',
};

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

  // 函数请求体上限 4.5MB，压到 2MB 以内才稳
  for (const q of [0.8, 0.65, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    const kb = Math.round((dataUrl.length * 3) / 4 / 1024);
    if (dataUrl.length < 2_600_000) return { dataUrl, width, height, kb };
  }
  throw new Error('这张图压不下去，换一张小一点的照片');
}

const SHELF = [
  { href: '/p/lamp', name: '台灯', parts: 7 },
  { href: '/p/radio', name: '收音机', parts: 7 },
  { href: '/p/fan', name: '台扇', parts: 5 },
];

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
  const [parcel, setParcel] = useState<{ url: string; qrSvg: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const busy = stage === 'gen' || stage === 'split';
  const progress = stage === 'done' ? 100 : stage === 'split' ? 68 : stage === 'gen' ? 30 : 0;

  const pick = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('这不是图片');
      setStage('error');
      return;
    }
    setError('');
    try {
      setImg(await toDataUrl(file));
      setParcel(null);
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
    setParcel(null);
    setCopied(false);
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

      // 单件建模实测 5-10 分钟，留足 12 分钟窗口
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
        body: JSON.stringify({ u: splitUrl, sender: sender.trim(), line: line.trim(), qrInk: true }),
      });
      const parcelJson = (await parcelRes.json()) as { url?: string; qrSvg?: string; error?: string };
      if (!parcelRes.ok || !parcelJson.url) throw new Error(parcelJson.error || '打包失败');

      setParcel({ url: parcelJson.url, qrSvg: parcelJson.qrSvg ?? '' });
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了');
      setStage('error');
    } finally {
      window.clearInterval(ticker);
    }
  }, [img, busy, sender, line]);

  const statusLine = stage === 'gen'
    ? genPhase === 'pending' ? '照片排在队里，等着开始长' : '正在把照片变成一个形状'
    : stage === 'split'
      ? splitPhase === 'pending' ? '形状有了，排着队等拆零件' : '正在按结构拆成零件'
      : stage === 'done'
        ? '装进盒子里了'
        : '';

  return (
    <main className="lv-page">
      <div className="lv-desk">
        <div className="lv-top">
          <Link href="/" className="lv-back">← 回到门口</Link>
          <span className="lv-seal" aria-hidden="true"><b>无名</b><b>件</b></span>
        </div>

        <header className="lv-head">
          <h1 className="lv-title">拍一件东西<br />它会以拆散的样子到达</h1>
          <p className="lv-sub">
            照片先长成一个粗模，再被拆成一块块能拉出来的零件；你写的那句话压在最里面那块底下，收件人得拆到那儿才看得到。
          </p>
          <p className="lv-fact">一件要几分钟。链接出来之后，才需要人。</p>
        </header>

        <div className="lv-body">
          <div className="lv-left">
            <button
              type="button"
              className={`lv-slot${img ? ' has-photo' : ''}${busy ? ' is-busy' : ''}`}
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {img ? (
                <>
                  <i className="lv-corner tl" aria-hidden="true" />
                  <i className="lv-corner tr" aria-hidden="true" />
                  <i className="lv-corner bl" aria-hidden="true" />
                  <i className="lv-corner br" aria-hidden="true" />
                  <img src={img.dataUrl} alt="要寄出去的那件东西" className="lv-photo" />
                  <span className="lv-tape lv-tape-l" aria-hidden="true" />
                  <span className="lv-tape lv-tape-r" aria-hidden="true" />
                  {!busy && <span className="lv-swap">换一张</span>}
                </>
              ) : (
                <span className="lv-slot-hint">
                  <i className="lv-corner tl" aria-hidden="true" />
                  <i className="lv-corner tr" aria-hidden="true" />
                  <i className="lv-corner bl" aria-hidden="true" />
                  <i className="lv-corner br" aria-hidden="true" />
                  把照片贴在这里
                  <em>点一下选照片，或用手机现拍一张</em>
                </span>
              )}
            </button>

            <p className="lv-slot-meta">
              {img ? `${img.width}×${img.height} · 压成 JPEG ${img.kb} KB · 会按轮廓找零件` : '白底或浅底、东西占满画面最好认'}
            </p>

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

            <div className="lv-shelf">
              <span className="lv-shelf-cap">已经寄出的，可以直接拆：</span>
              {SHELF.map((it) => (
                <a key={it.name} href={it.href} className="lv-shelf-link">
                  {it.name}<em>{it.parts} 块</em>
                </a>
              ))}
            </div>
          </div>

          <div className="lv-right">
            <label className="lv-field">
              <span className="lv-field-label">署名</span>
              <input
                value={sender}
                onChange={(e) => setSender(e.target.value)}
                placeholder="不写也行"
                maxLength={12}
                disabled={busy}
              />
              <em>不写就署名“一个没留名的人”</em>
            </label>

            <label className="lv-field is-line">
              <span className="lv-field-label">那句话</span>
              <textarea
                value={line}
                onChange={(e) => setLine(e.target.value)}
                placeholder="他拆到最里面那块，才会看到这句。"
                maxLength={80}
                rows={3}
                disabled={busy}
              />
              <em>{line.length}/80 · 必须写，它只出现在最里面那块里</em>
            </label>

            <div className="lv-action">
              <button
                type="button"
                className="lv-go"
                disabled={!img || busy || !line.trim()}
                onClick={() => {
                  if (stage === 'done') {
                    setStage('idle');
                    setImg(null);
                    setParcel(null);
                    setGenPhase(null);
                    setSplitPhase(null);
                    setSeconds(0);
                    return;
                  }
                  void run();
                }}
              >
                {busy ? '在做，别关页面' : stage === 'done' ? '换一件东西再寄' : '封进去，让它长出来'}
              </button>
              <p className="lv-go-note">生成中可以离开，回来刷新还在这页。一件 = 一次生成 + 一次拆件。</p>
              {error && <p className="lv-error">{error}</p>}
            </div>

            <div className="lv-after">
              <p><b>拆开的时候</b>，那边看到的是它被拆成几块的样子，不是一张照片。</p>
              <p><b>得自己动手</b>：按住一块往外拉，被压着的拉不动；顺序错了，纸上会留撬痕。</p>
              <p><b>最里面那块底下</b>压着你写的那句话，拆到那儿才会翻出来。</p>
            </div>
          </div>
        </div>

        {(busy || stage === 'done') && (
          <section className="lv-track">
            <div className="lv-bar">
              <i className={busy ? 'is-waiting' : ''} style={{ width: `${progress}%` }} />
            </div>
            <p className="lv-track-line">
              {statusLine}
              <b>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</b>
            </p>
            <ol className="lv-track-steps">
              <li className={stage !== 'gen' ? 'is-past' : 'is-now'}>
                <span>建模</span><em>{genPhase ? PHASE_TEXT[genPhase] : '没开始'}</em>
              </li>
              <li className={stage === 'done' ? 'is-past' : stage === 'split' ? 'is-now' : ''}>
                <span>拆成零件</span><em>{splitPhase ? PHASE_TEXT[splitPhase] : '等建模'}</em>
              </li>
              <li className={stage === 'done' ? 'is-past' : ''}>
                <span>装盒出链接</span><em>{parcel ? '好了' : stage === 'done' ? '好了' : '等前两步'}</em>
              </li>
            </ol>
          </section>
        )}

        {stage === 'done' && parcel && (
          <section className="lv-label">
            <div className="lv-label-main">
              <span className="lv-label-cap">装好了 · 这条链接就是盒子</span>
              <a className="lv-label-url" href={parcel.url} target="_blank" rel="noreferrer">{parcel.url}</a>
              <div className="lv-label-actions">
                <a className="lv-open" href={parcel.url}>拆开它</a>
                <button
                  type="button"
                  className="lv-copy"
                  onClick={() => {
                    void navigator.clipboard?.writeText(parcel.url);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? '已复制' : '复制链接'}
                </button>
              </div>
            </div>
            {parcel.qrSvg && <div className="lv-label-qr" dangerouslySetInnerHTML={{ __html: parcel.qrSvg }} />}
          </section>
        )}
      </div>
    </main>
  );
}
