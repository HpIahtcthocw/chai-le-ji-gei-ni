import { NextResponse, type NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { isAllowedModelUrl } from '@/lib/lux3d';
import { encodeParcel } from '@/lib/parcels';

const ID_RE = /^[a-z0-9_-]+$/i;

function originOf(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto');
  const host = req.headers.get('host');
  if (host) return `${proto || 'http'}://${host}`;
  return req.nextUrl.origin;
}

/**
 * 打包一件东西：要么是本机仓库里的资产（a），要么是刚生成出来的模型地址（u）。
 * 状态全编进链接，不落库。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    sender?: string;
    image?: string;
    line?: string;
    u?: string;
  };

  // 线上生成的件没有本地资产，用官方 CDN 的模型地址，只认白名单域
  const modelUrl = typeof body.u === 'string' && isAllowedModelUrl(body.u) ? body.u : undefined;

  const assetId =
    !modelUrl && typeof body.assetId === 'string' && ID_RE.test(body.assetId) ? body.assetId : 'lamp';
  const sender = typeof body.sender === 'string' ? body.sender.trim().slice(0, 24) : '';
  const image = typeof body.image === 'string' && /^https:\/\//.test(body.image) ? body.image : undefined;
  const line = typeof body.line === 'string' ? body.line.trim().slice(0, 80) : '';

  const parcel = modelUrl
    ? { a: 'remote', u: modelUrl, s: sender || undefined, i: image, m: line || undefined, t: Date.now() }
    : { a: assetId, s: sender || undefined, i: image, m: line || undefined, t: Date.now() };

  const code = encodeParcel(parcel);
  const origin = originOf(req);
  const url = `${origin}/p/${code}`;
  const qrSvg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#f4ede2', light: '#00000000' },
  });

  return NextResponse.json({ code, url, qrSvg });
}
