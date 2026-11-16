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

  // 演示件的纸条内容先用 meta 里的故事；真实任务接上以后换成寄件人写的那句
  const message = meta.story.replace(/^寄件人留言：/, '');

  return (
    <LockProto
      src={`/items/${parcel.a}/model.glb`}
      sender={parcel.s?.trim() || '一个没留名的人'}
      itemName={meta.name}
      message={message}
      labels={labels}
    />
  );
}
