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

export default function SendPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [meta, setMeta] = useState('');
  const [sender, setSender] = useState('');
  const [packing, setPacking] = useState(false);

  const pack = useCallback(async () => {
    if (!remoteUrl || packing) return;
    setPacking(true);
    setMessage('正在装盒…');
    try {
      const res = await fetch('/api/parcel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: 'lamp', sender, image: remoteUrl }),
      });
      const json = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !json.code) throw new Error(json.error || `装盒失败 ${res.status}`);
      router.push(`/s/${encodeURIComponent(json.code)}`);
    } catch (err) {
      setPhase('error');
      setPacking(false);
      setMessage(err instanceof Error ? err.message : '装盒失败');
    }
  }, [remoteUrl, packing, sender, router]);

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

  return (
    <main className="send-page">
      <div className="send-inner">
        <div className="send-top">
          <Link href="/" className="send-back">← 回到门口</Link>
          <div className="send-step">寄件 · 01 拍照</div>
        </div>

        <h1 className="send-title">拍一件<br />你愿意拆开的东西</h1>
        <p className="send-lead">
          它会被拆成零件，装进盒子寄出去。<br />
          收件人拿到链接，一块一块拆出来，看看还认不认得。
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
            <div className="send-url-label">照片已入库，接下来装盒</div>
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

        <div className="send-foot">
          <div className="send-note">
            支持 JPG / PNG / WebP；HEIC 会在这里自动转成 JPEG，长边压到 2048。
          </div>
          <button
            type="button"
            className="send-next"
            disabled={!remoteUrl || packing}
            onClick={() => void pack()}
          >
            {packing ? '装盒中…' : '下一步：拆开装盒'}
          </button>
        </div>
      </div>
    </main>
  );
}
