import { notFound } from 'next/navigation';
import LockProto from '@/components/LockProto';
import { getItem } from '@/lib/items';
import { isAllowedModelUrl } from '@/lib/lux3d';
import { parseParcel } from '@/lib/parcels';

/** 收件人视角：打开链接就是盒子里的那件东西，按住一块往外拉 */

/**
 * 两种件：
 * - 仓库里的真产物：a 指向 public/items/<id>，零件带名字，纸条是 meta 里那句话
 * - 线上现生成的件：u 指向官方 CDN 的拆分 GLB，没有零件名，也没写“最旧的一块”
 */
export default async function ReceivePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parcel = parseParcel(decodeURIComponent(code));
  if (!parcel) notFound();

  const remote = parcel.u && isAllowedModelUrl(parcel.u) ? parcel.u : null;
  const meta = remote ? null : await getItem(parcel.a);
  if (!remote && !meta) notFound();

  // meta 里的 partId 就是 GLB 里的 mesh 下标，标签按它对齐
  const labels: Record<number, string> = {};
  if (meta) {
    for (const part of meta.parts ?? []) {
      const index = Number(part.partId.replace(/^part-/, ''));
      if (Number.isFinite(index) && part.label) labels[index] = part.label;
    }
  }

  // 纸条优先用包裹码里带的那句话（回信时会换人）；没有才回落到 meta 的故事
  const message = remote
    ? parcel.m || '拆到底了。这句是他留在最后一块里的。'
    : (parcel.m || meta!.story).replace(/^寄件人留言：/, '');

  return (
    <LockProto
      src={remote ?? meta?.glb ?? `/items/${parcel.a}/model.glb`}
      sender={parcel.s?.trim() || '一个没留名的人'}
      itemName={meta?.name ?? '一件刚长出来的东西'}
      message={message}
      labels={labels}
      photo={parcel.i || meta?.sourceImage}
      replyCode={remote ? undefined : code}
      oldest={!remote && meta?.oldest ? { label: meta.oldest, why: meta.oldestWhy } : undefined}
    />
  );
}
