'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  code: string;
  asset: string;
  photo?: string;
  heard: string;
  from: string;
};

/** 收件人回一句：同一件东西，纸条换成你的话，装回去，出一个新码寄回。 */
export default function ReplyForm({ code, asset, photo, heard, from }: Props) {
  const router = useRouter();
  const [line, setLine] = useState('');
  const [sign, setSign] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!line.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asset, photo, line: line.trim(), sign: sign.trim() }),
      });
      const json = (await res.json()) as { code?: string; error?: string };
      if (!res.ok || !json.code) throw new Error(json.error || `寄回去失败 ${res.status}`);
      router.push(`/s/${encodeURIComponent(json.code)}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : '寄回去失败');
    }
  };

  return (
    <main className="send-page">
      <div className="send-inner">
        <div className="send-top">
          <a href={`/p/${encodeURIComponent(code)}`} className="send-back">
            ← 回去接着拆
          </a>
        </div>

        <h1 className="send-title">
          你拆完了
          <br />
          也回一句
        </h1>

        <div className="reply-heard">
          <span className="reply-heard-label">{from} 夹在里面的那句话</span>
          <p>{heard}</p>
        </div>

        <label className="send-sign">
          <span>署名</span>
          <input
            value={sign}
            onChange={(e) => setSign(e.target.value)}
            placeholder="他可能会猜是谁"
            maxLength={12}
          />
        </label>

        <label className="send-line">
          <span>你的那句</span>
          <textarea
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="装回箱子里，他拆到最后一块才会看到。"
            maxLength={80}
            rows={3}
          />
          <em>{line.length}/80</em>
        </label>

        <div className="send-foot">
          <div className="send-note">{photo ? '这件东西还是同一件，原样装回去。' : '同一件东西，原样装回去。'}</div>
          <button type="button" className="send-next" disabled={!line.trim() || busy} onClick={() => void send()}>
            {busy ? '正在装回去…' : '装回去，寄回给他'}
          </button>
        </div>

        {error && <p className="send-status-text is-error">{error}</p>}
      </div>
    </main>
  );
}
