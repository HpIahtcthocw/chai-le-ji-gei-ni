import { notFound } from 'next/navigation';
import GameScene from '@/components/GameScene';
import { getItem } from '@/lib/items';
import { parseParcel } from '@/lib/parcels';

/** 收件人视角：点了链接就开始拆包、拼、猜、亮灯、导 STL */
export default async function ReceivePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parcel = parseParcel(decodeURIComponent(code));
  if (!parcel) notFound();
  const meta = await getItem(parcel.a);
  if (!meta) notFound();
  return <GameScene meta={meta} />;
}
