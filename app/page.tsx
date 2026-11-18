import Link from 'next/link';
import LockProto from '@/components/LockProto';
import { getItem, listItemIds } from '@/lib/items';

export const dynamic = 'force-dynamic';

/**
 * 首页 = 一个已经寄到的包裹。
 * 不做介绍页：进来就能按住零件往外拉，拆到底会翻出夹在里面的纸条。
 */
export default async function Home() {
  const ids = await listItemIds();
  const items = (await Promise.all(ids.map((id) => getItem(id)))).filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );

  // 优先挑一件零件带名字的，拆开时标签才是“灯罩/底座”，不是一个字“零件”
  const demo = items.find((it) => it.parts?.some((p) => p.label)) ?? items[0];

  const labels: Record<number, string> = {};
  if (demo) {
    for (const part of demo.parts ?? []) {
      const index = Number(part.partId.replace(/^part-/, ''));
      if (Number.isFinite(index) && part.label) labels[index] = part.label;
    }
  }

  if (!demo) {
    return (
      <main className="home-empty">
        <p>还没有可拆的包裹。先去寄一件。</p>
        <Link href="/send">寄一件</Link>
      </main>
    );
  }

  return (
    <>
      <LockProto
        src={`/items/${demo.id}/model.glb`}
        sender="一个陌生人"
        itemName={demo.name}
        message={demo.story.replace(/^寄件人留言：/, '')}
        labels={labels}
      />

      <div className="home-jump">
        <span className="home-jump-mark">无名件</span>
        <Link href="/send" className="home-jump-link">
          寄一件你自己的
        </Link>
      </div>
    </>
  );
}
