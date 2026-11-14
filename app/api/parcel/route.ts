import { NextResponse, type NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { encodeParcel } from '@/lib/parcels';

const ID_RE = /^[a-z0-9_-]+$/i;

function originOf(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto');
  const host = req.headers.get('host');
  if (host) return `${proto || 'http'}://${host}`;
  return req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    sender?: string;
    image?: string;
  };

  const assetId = typeof body.assetId === 'string' && ID_RE.test(body.assetId) ? body.assetId : 'lamp';
  const sender = typeof body.sender === 'string' ? body.sender.trim().slice(0, 24) : '';
  const image = typeof body.image === 'string' && /^https:\/\//.test(body.image) ? body.image : undefined;

  const parcel = { a: assetId, s: sender || undefined, i: image, t: Date.now() };
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
