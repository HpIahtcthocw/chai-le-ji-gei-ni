import { notFound } from 'next/navigation';
import LockProto from '@/components/LockProto';
import { getItem } from '@/lib/items';
import { parseParcel } from '@/lib/parcels';

/** 收件人视角：打开链接就是盒子里的那件东西，按住一块往外拉 */

export default async function ReceivePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parcel = parseParcel(decodeURIComponent(code));
  if (!parcel) notFound();
  const meta = await getItem(parcel.a);
  if (!meta) notFound();

  // meta 里的 partId 就是 GLB 里的 mesh 下标，标签按它对齐
  const labels: Record<number, string> = {};
  for (const part of meta.parts) {
    const index = Number(part.partId.replace(/^part-/, ''));
    if (Number.isFinite(index) && part.label) labels[index] = part.label;
  }

  // 纸条优先用包裹码里带的那句话（回信时会换人）；没有才回落到 meta 的故事
  const message = (parcel.m || meta.story).replace(/^寄件人留言：/, '');

  return (
    <LockProto
      src={`/items/${parcel.a}/model.glb`}
      sender={parcel.s?.trim() || '一个没留名的人'}
      itemName={meta.name}
      message={message}
      labels={labels}
      photo={parcel.i || meta.sourceImage}
      replyCode={code}
      oldest={meta.oldest ? { label: meta.oldest, why: meta.oldestWhy } : undefined}
    />
  );
}
