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

  // 展品优先取 featured；没有就挑一件零件带名字的（拆开时标签才是“灯罩/底座”）
  const demo =
    items.find((it) => it.featured) ??
    items.find((it) => it.parts?.some((p) => p.label)) ??
    items[0];

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

  // 门口还放着别的包裹：都能拆，说明这套流程不是只对一件东西成立
  const others = items.filter((it) => it.id !== demo.id && it.parts?.some((p) => p.label));
  // 线上版走无状态的现生成（提交 + 轮询）；本机版直接进本机生成流程
  const online = process.env.NEXT_PUBLIC_ONLINE_GEN === '1';
  const canSend = online || process.env.NEXT_PUBLIC_DEMO !== '1';
  const sendHref = online ? '/live' : '/send';

  return (
    <>
      <LockProto
        src={demo.glb ?? `/items/${demo.id}/model.glb`}
        sender="一个陌生人"
        itemName={demo.name}
        message={demo.story.replace(/^寄件人留言：/, '')}
        labels={labels}
      />

      <div className="home-jump">
        {canSend ? (
          <div className="home-jump-row">
            <Link href={sendHref} className="home-jump-link">
              寄一件你自己的
            </Link>
            <span className="home-jump-note">拍一张照，现场长出一件（要几分钟）</span>
          </div>
        ) : (
          <div className="home-jump-row">
            <span className="home-jump-lead">这三件都是真寄过来的，随便拆</span>
          </div>
        )}
        {others.length > 0 && (
          <div className="home-shelf">
            <span>门口还放着：</span>
            {others.map((it) => (
              <Link key={it.id} href={`/p/${it.id}`} className="home-shelf-item">
                {it.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
