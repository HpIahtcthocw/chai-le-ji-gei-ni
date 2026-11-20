'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

const MAX_EDGE = 2048;

type Phase = 'idle' | 'working' | 'done' | 'error';

/** 把任意手机照片统一成 JPEG：手机原图常是 HEIC，Lux3D 只认 jpg/jpeg/png/webp */
async function normalize(file: File): Promise<{ blob: Blob; width: number; height: number }> {
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
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) throw new Error('图片转 JPEG 失败');
  return { blob, width, height };
}

const DEMO_BUILD = process.env.NEXT_PUBLIC_DEMO === '1';

export default function SendPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [meta, setMeta] = useState('');
  const [sender, setSender] = useState('');
  const [line, setLine] = useState('');
  const [packing, setPacking] = useState(false);

  const pack = useCallback(async () => {
    if (!remoteUrl || packing || !line.trim()) return;
    setPacking(true);
    setMessage('正在排生成任务…');
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: remoteUrl, sentence: line, sender }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !json.id) throw new Error(json.error || `排任务失败 ${res.status}`);
      router.push(`/job/${json.id}`);
    } catch (err) {
      setPhase('error');
      setPacking(false);
      setMessage(err instanceof Error ? err.message : '排任务失败');
    }
  }, [remoteUrl, packing, line, sender, router]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setPhase('error');
      setMessage('这不是图片文件');
      return;
    }
    setPhase('working');
    setMessage('正在压缩成 JPEG…');
    try {
      const { blob, width, height } = await normalize(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      setMeta(`${width}×${height} · ${(blob.size / 1024).toFixed(0)} KB`);
      setMessage('正在上传到仓库…');

      const form = new FormData();
      form.append('file', new File([blob], 'parcel.jpg', { type: 'image/jpeg' }));
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error || `上传失败 ${res.status}`);
      setRemoteUrl(json.url);
      setPhase('done');
      setMessage('已入库');
    } catch (err) {
      setPhase('error');
      setMessage(err instanceof Error ? err.message : '出错了');
    }
  }, [preview]);

  if (DEMO_BUILD) {
    return (
      <main className="send-page">
        <div className="send-inner">
          <div className="send-top">
            <Link href="/" className="send-back">← 回到门口</Link>
          </div>
          <h1 className="send-title">寄一件<br />你自己的</h1>
          <p className="send-lead">
            放进一张照片，写一句话，剩下的交给拆件台。<br />
            五到十分钟，出来的是能拆的链接。
          </p>
          <div className="send-foot">
            <div className="send-note">已经在线的七件都能拆：闹钟、台扇、台灯、拨盘电话、收音机、老缝纫机。</div>
            <Link className="send-next" href="/live">去拆件台</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="send-page">
      <div className="send-inner">
        <div className="send-top">
          <Link href="/" className="send-back">← 回到门口</Link>
          
        </div>

        <h1 className="send-title">拍一件<br />你愿意拆开的东西</h1>
        <p className="send-lead">
          它会被拆开，装进一个盒子寄出去。<br />
          他拿到链接，一块块拆出来，看还认不认得。
        </p>

        <button
          type="button"
          className={phase === 'working' ? 'send-drop is-busy' : 'send-drop'}
          onClick={() => inputRef.current?.click()}
          disabled={phase === 'working'}
        >
          {preview ? (
            <img src={preview} alt="待寄出的照片" className="send-preview" />
          ) : (
            <span className="send-drop-hint">点击选择照片，或用手机拍一张</span>
          )}
          {preview && <span className="send-drop-repick">换一张</span>}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />

        <div className="send-status">
          {message && (
            <span className={phase === 'error' ? 'send-status-text is-error' : 'send-status-text'}>
              {message}
            </span>
          )}
          {meta && phase !== 'error' && <span className="send-status-meta">{meta}</span>}
        </div>

        {remoteUrl && (
          <div className="send-url">
            <div className="send-url-label">照片收到了。写一句话，最后一块才给他看。</div>
            <a className="send-url-value" href={remoteUrl} target="_blank" rel="noreferrer">{remoteUrl}</a>
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
          <span>那句话</span>
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
          <div className="send-note">
            手机原图直接传就行，大图会先压一下。
          </div>
          <button
            type="button"
            className="send-next"
            disabled={!remoteUrl || packing || !line.trim()}
            onClick={() => void pack()}
          >
            {packing ? '等一下…' : '让它长出来'}
          </button>
        </div>
      </div>
    </main>
  );
}
