import { NextResponse } from 'next/server';
import { getItem } from '@/lib/items';
import { encodeParcel } from '@/lib/parcels';

/**
 * 回一句：同一件资产，换署名、换那句话，出一个新的包裹码。
 * 不出新模型，也不消耗 Lux3D 额度——装回去用的还是原来那七块。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { asset?: string; photo?: string; line?: string; sign?: string };
    const asset = (body.asset || '').trim();
    const line = (body.line || '').trim().slice(0, 80);
    if (!asset || !line) {
      return NextResponse.json({ error: '缺东西或那句话' }, { status: 400 });
    }
    const meta = await getItem(asset);
    if (!meta) return NextResponse.json({ error: '这件东西不在仓库里' }, { status: 404 });

    const code = encodeParcel({
      a: asset,
      s: (body.sign || '').trim().slice(0, 12) || undefined,
      i: typeof body.photo === 'string' && body.photo.startsWith('http') ? body.photo : undefined,
      t: Date.now(),
      m: line,
    });

    return NextResponse.json({ code });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '回信失败' },
      { status: 500 },
    );
  }
}
