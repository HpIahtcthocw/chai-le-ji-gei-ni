'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import HeroStage from '@/components/HeroStage';

/**
 * 拆件台：一个 95 年那种模样的窗口应用。
 * 一打开就是工作台——左边说明和现成的包，中间真台灯，右边寄件单，不用先猜要干什么。
 * 无状态链路——提交拿任务号，浏览器每 3 秒查一次，模型地址编进包裹链接。
 */
const MAX_EDGE = 1600;

type Stage = 'idle' | 'gen' | 'split' | 'done' | 'error';
type Phase = 'pending' | 'running' | 'done' | 'failed';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PHASE_TEXT: Record<Phase, string> = {
  pending: '排队中',
  running: '进行中',
  done: '完成',
  failed: '失败',
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

const FALLBACK_PARTS = 7;

const SHELF = [
  { href: '/p/lamp', name: '台灯', parts: 7, note: '最早寄出的那件' },
  { href: '/p/radio', name: '收音机', parts: 7, note: '按轮廓拆的' },
  { href: '/p/fan', name: '台扇', parts: 5, note: '件数少的' },
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
  const [hold, setHold] = useState<'auto' | 'open' | 'closed'>('auto');
  const [packing, setPacking] = useState(false);

  const busy = stage === 'gen' || stage === 'split';
  const progress = stage === 'done' ? 100 : stage === 'split' ? 68 : stage === 'gen' ? 28 : 0;
  const goLabel = busy
    ? '正在做，别关窗口'
    : stage === 'done'
      ? '再寄一件'
      : !img
        ? '先放一张照片'
        : !line.trim()
          ? '还得写那句话'
          : '开始拆件 ▶';

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

  const useSample = useCallback(async () => {
    try {
      const res = await fetch('/example/camera.jpg');
      const blob = await res.blob();
      await pick(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
    } catch {
      setError('示例照片取不到');
      setStage('error');
    }
  }, [pick]);

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
      setPacking(true);
      window.setTimeout(() => setPacking(false), 1900);
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '出错了');
      setStage('error');
    } finally {
      window.clearInterval(ticker);
    }
  }, [img, busy, sender, line]);

  const clock = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const status = stage === 'gen'
    ? genPhase === 'pending' ? '等队列' : '建模中'
    : stage === 'split'
      ? splitPhase === 'pending' ? '等队列' : '拆件中'
      : stage === 'done'
        ? '已完成'
        : stage === 'error'
          ? '出错了'
          : '就绪';

  return (
    <main className="rt-page">
      <div className="rt-desktop">
        <nav className="rt-icons">
          <Link href="/" className="rt-icon">
            <span className="rt-icon-glyph" aria-hidden="true">⌂</span>
            <span>门口</span>
          </Link>
          <span className="rt-icon is-active">
            <span className="rt-icon-glyph" aria-hidden="true">▤</span>
            <span>拆件台</span>
          </span>
          <a href="#how" className="rt-icon">
            <span className="rt-icon-glyph" aria-hidden="true">?</span>
            <span>怎么用</span>
          </a>
        </nav>

        <div className="rt-win">
          <header className="rt-titlebar">
            <span className="rt-titlebar-icon" aria-hidden="true">▣</span>
            <span className="rt-titlebar-text">无名件 拆件台 — 台灯.glb（16 MB，七件）</span>
            <span className="rt-titlebar-btns" aria-hidden="true"><b>_</b><b>□</b><b>×</b></span>
          </header>

          <div className="rt-menubar">
            <span>文件</span>
            <span>编辑</span>
            <span>视图</span>
            <span>帮助</span>
            <span className="rt-menubar-gap" />
            <span className="rt-menubar-note">这台机器连得上，一件要等五到十分钟</span>
          </div>

          <div className="rt-body">
            <section className="rt-col rt-col-a">
              <div className="rt-group">
                <div className="rt-group-title">怎么用</div>
                <ol className="rt-steps" id="how">
                  <li><b>放进一张照片</b><span>白底或浅底最认得出，别裁太紧</span></li>
                  <li><b>写一句话</b><span>它会压在最里面那块底下，拆到那儿才看得到</span></li>
                  <li><b>按「开始拆件」</b><span>五到十分钟，出来就是一条链接</span></li>
                </ol>
              </div>

              <div className="rt-group">
                <div className="rt-group-title">示例照片</div>
                <button type="button" className="rt-sample" onClick={() => void useSample()} disabled={busy}>
                  <img src="/example/camera.jpg" alt="示例：一台旧胶片相机" />
                  <span className="rt-sample-note">
                    旧相机，点一下就用
                    <em>这一件真跑过，散成九块</em>
                  </span>
                </button>
              </div>

              <div className="rt-group">
                <div className="rt-group-title">现成的包</div>
                <ul className="rt-list">
                  {SHELF.map((it) => (
                    <li key={it.name}>
                      <span className="rt-list-glyph" aria-hidden="true">▮</span>
                      <span className="rt-list-name">{it.name}<em>{it.note}</em></span>
                      <span className="rt-list-count">{it.parts} 件</span>
                      <a className="rt-list-open" href={it.href}>打开</a>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="rt-col rt-col-b">
              <div className="rt-pane">
                <div className="rt-pane-title">拆解台 — 台灯（7 件）</div>
                <div className="rt-stage">
                  <HeroStage
                    src="https://qhsmodel.kujiale.com/glbPartsReconstructResult/NL3JEMAKTJJSAAABAAAAADI8.glb"
                    mode={hold}
                    onUserToggle={(open) => setHold(open ? 'open' : 'closed')}
                  />
                  <span className="rt-stage-hint">拖住转，两指缩放，点一下散开</span>
                  {packing && (
                    <div className="rt-pack">
                      <div className="rt-pack-bar">
                        <span>装箱</span>
                        <span className="rt-pack-x">×</span>
                      </div>
                      <div className="rt-pack-body">
                        <div className="rt-pack-file" aria-hidden="true">▤</div>
                        <p>
                          把台上这 <b>{FALLBACK_PARTS}</b> 件装回盒子……
                          <em>盖上去，就成一条链接</em>
                        </p>
                      </div>
                      <div className="rt-pack-track">
                        <i />
                      </div>
                    </div>
                  )}
                  {hold === 'open' && (
                    <div className="rt-slip">
                      <b>最里面那块底下</b>
                      <span>{line.trim() ? `「${line.trim()}」` : '「你还没写——写完就压在这一块底下」'}</span>
                      <em>收件的人拆到这一块，才看得到</em>
                    </div>
                  )}
                </div>
                <div className="rt-toolbar">
                  <button
                    type="button"
                    className={`rt-toolbtn${hold === 'closed' ? ' is-on' : ''}`}
                    onClick={() => setHold('closed')}
                  >
                    合上
                  </button>
                  <button
                    type="button"
                    className={`rt-toolbtn${hold === 'open' ? ' is-on' : ''}`}
                    onClick={() => setHold('open')}
                  >
                    拆开
                  </button>
                  <button
                    type="button"
                    className={`rt-toolbtn${hold === 'auto' ? ' is-on' : ''}`}
                    onClick={() => setHold('auto')}
                  >
                    自动循环
                  </button>
                  <span className="rt-toolbar-gap" />
                  <span className="rt-readout">原来挂着的那件 · 真拆过</span>
                </div>
              </div>
            </section>

            <section className="rt-col rt-col-c">
              <div className="rt-group">
                <div className="rt-group-title">寄件单</div>

                <button
                  type="button"
                  className={`rt-slot${img ? ' has-photo' : ''}`}
                  onClick={() => inputRef.current?.click()}
                  disabled={busy}
                >
                  {img ? (
                    <img src={img.dataUrl} alt="要寄出去的这件" />
                  ) : (
                    <span className="rt-slot-empty">
                      <b>照片</b>
                      点这里从相册里挑，或者现在就拍
                      <i>先压到 1600 宽，原图不上传</i>
                    </span>
                  )}
                </button>
                <p className="rt-slot-meta">
                  {img ? `${img.width}×${img.height} · 压成 ${img.kb} KB · 原图不上传` : '还没放照片；也可以先点左边那张示例'}
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

                <label className="rt-field">
                  <span>署名</span>
                  <input
                    value={sender}
                    onChange={(e) => setSender(e.target.value)}
                    placeholder="不写也行"
                    maxLength={12}
                    disabled={busy}
                  />
                </label>

                <label className="rt-field">
                  <span>那句话（必写）</span>
                  <textarea
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    placeholder="他拆到最里面那块，才会看到这句。"
                    maxLength={80}
                    rows={3}
                    disabled={busy}
                  />
                  <em>{line.length}/80</em>
                </label>

                <button
                  type="button"
                  className="rt-go"
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
                  {goLabel}
                </button>

                {(busy || stage === 'done') && (
                  <div className="rt-progress">
                    <div className="rt-progress-bar">
                      <i style={{ width: `${progress}%` }} />
                    </div>
                    <div className="rt-progress-line">
                      <span>{status}</span>
                      <b>{clock}</b>
                    </div>
                    <ul className="rt-log">
                      <li>建模：{genPhase ? PHASE_TEXT[genPhase] : '未开始'}</li>
                      <li>拆件：{splitPhase ? PHASE_TEXT[splitPhase] : '未开始'}</li>
                      <li>装盒：{stage === 'done' ? '完成' : '等前两步'}</li>
                    </ul>
                  </div>
                )}

                {error && <p className="rt-error">{error}</p>}

                {stage === 'done' && parcel && (
                  <div className="rt-result">
                    <span className="rt-result-cap">链接就是盒子</span>
                    <a className="rt-result-url" href={parcel.url} target="_blank" rel="noreferrer">{parcel.url}</a>
                    <div className="rt-result-actions">
                      <a className="rt-result-open" href={parcel.url}>拆开</a>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(parcel.url);
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1800);
                        }}
                      >
                        {copied ? '已复制' : '复制'}
                      </button>
                    </div>
                    {parcel.qrSvg && <div className="rt-result-qr" dangerouslySetInnerHTML={{ __html: parcel.qrSvg }} />}
                  </div>
                )}
              </div>

              <div className="rt-group">
                <div className="rt-group-title">这一件要花多少功夫</div>
                <ul className="rt-cost">
                  <li><b>建模一次</b><span>照片变成十二万面的模型，五分钟上下</span></li>
                  <li><b>拆件一次</b><span>按轮廓切成零件，两分钟</span></li>
                  <li><b>不用人看</b><span>出来就是链接，摊开等你自己拆</span></li>
                </ul>
              </div>
            </section>
          </div>

          <footer className="rt-statusbar">
            <span className="rt-status-cell">{status}</span>
            <span className="rt-status-cell">{img ? '照片已就位' : '没有照片'}</span>
            <span className="rt-status-cell">{line.trim() ? '那句话已写' : '还没写那句话'}</span>
            <span className="rt-status-cell rt-status-right">收件那头螺丝是松的，得自己一块块拉开来</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
