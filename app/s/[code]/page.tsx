import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import CopyLink from '@/components/CopyLink';
import { getItem } from '@/lib/items';
import { parseParcel } from '@/lib/parcels';

/** 寄件人视角的最后一屏：装盒完成、出码、把链接发出去。
 *  这一页刻意不加载任何 3D：16MB 模型只在真正要看/要玩的那一页拉一次，
 *  否则用户一点"打开收件人视角"，在途的大请求被掐断，会把下一页的载入也带崩。 */
export default async function SharePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parcel = parseParcel(decodeURIComponent(code));
  if (!parcel) notFound();
  const meta = await getItem(parcel.a);
  if (!meta) notFound();

  const h = await headers();
  const host = h.get('host') || 'localhost:3100';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  const url = `${proto}://${host}/p/${encodeURIComponent(code)}`;

  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    color: { dark: '#f4ede2', light: '#00000000' },
  });

  return (
    <main className="share-page">
      <div className="share-panel">
        <div className="share-top">
          <Link href="/" className="share-back">
            ← 门口
          </Link>
          <span className="share-step">装盒完成</span>
        </div>

        <h1 className="share-title">
          已经装好了
          <span>七块</span>
        </h1>
        <p className="share-lede">
          把码给对方。他打开就是一件被拆散的东西，一块一块往外拉，
          最后一块里夹着你写的那句话。
        </p>

        <div className="share-box">
          <div className="share-box-side">
            <span className="share-box-stamp">已封箱</span>
            <span className="share-box-code">{meta.name}</span>
          </div>
          <ul className="share-manifest">
            {meta.parts.map((part, index) => (
              <li key={part.partId}>
                <span className="share-manifest-num">{String(index + 1).padStart(2, '0')}</span>
                <span className="share-manifest-line" />
                <span className="share-manifest-mark">✓</span>
              </li>
            ))}
          </ul>
          <div className="share-box-foot">
            <span>{meta.parts.length} / {meta.parts.length} 件</span>
            <span>{parcel.s?.trim() || '未署名'}</span>
          </div>
        </div>

        <div className="share-qr" dangerouslySetInnerHTML={{ __html: qrSvg }} />

        <div className="share-link">
          <code>{url}</code>
          <CopyLink url={url} />
        </div>

        <div className="share-actions">
          <Link href={`/p/${encodeURIComponent(code)}`} className="share-primary">
            打开收件人视角
          </Link>
          <Link href="/send" className="share-ghost">
            再寄一件
          </Link>
        </div>

        <p className="share-note">
          这一版先用预置的台灯把拆包走一遍；你拍的那张照片已经存下来了，就贴在右边。
        </p>
      </div>

      {parcel.i && (
        <figure className="share-photo">
          {/* 寄件人自己拍的那张，原样放出来：它是这个包裹唯一的"实物证据" */}
          <img src={parcel.i} alt="寄件人拍下的照片" />
          <figcaption>
            <span>寄件人拍下的那一张</span>
            <span>{new Date(parcel.t || Date.now()).toLocaleDateString('zh-CN')}</span>
          </figcaption>
        </figure>
      )}
    </main>
  );
}
