import { notFound } from 'next/navigation';
import ReplyForm from '@/components/ReplyForm';
import { getItem } from '@/lib/items';
import { parseParcel } from '@/lib/parcels';

export const dynamic = 'force-dynamic';

/** 收件人拆完那一屏的延伸：回一句，装回去，寄回原主 */
export default async function ReplyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parcel = parseParcel(decodeURIComponent(code));
  if (!parcel) notFound();
  const meta = await getItem(parcel.a);
  if (!meta) notFound();

  const heard = (parcel.m || meta.story).replace(/^寄件人留言：/, '');
  const from = parcel.s?.trim() || '一个没留名的人';

  return (
    <ReplyForm
      code={code}
      asset={parcel.a}
      photo={parcel.i}
      heard={heard}
      from={from}
    />
  );
}
