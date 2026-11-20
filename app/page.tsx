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
  const others = items.filter((it) => it.id !== demo.id);
  // 线上版走无状态的现生成（提交 + 轮询）；本机版直接进本机生成流程
  // 线上入口固定指向拆件台：那里能传照片、能生成、能拆；/send 是本机专用流程
  const sendHref = '/live';

  return (
    <>
      <LockProto
        src={demo.glb ?? `/items/${demo.id}/model-slim.glb`}
        sender="一个陌生人"
        itemName={demo.name}
        message={demo.story.replace(/^寄件人留言：/, '')}
        labels={labels}
      />

      <div className="home-jump">
        <div className="home-jump-row">
          <a href={sendHref} className="home-jump-link">
            寄一件你自己的
          </a>
          <span className="home-jump-note">拍一张照，等五到十分钟，出来就是一条能拆的链接</span>
          <a href="/show" className="home-jump-link home-jump-alt">
            门口
          </a>
        </div>
        <div className="home-wall-head">
          一件东西拆成零件寄过来，最后一块底下压着一句话。门口这几件都能拆：
        </div>
        {others.length > 0 && (
          <ul className="home-wall">
            {others.map((it, index) => (
              <li key={it.id} className="home-wall-card">
                <span className="home-wall-no">{String(index + 2).padStart(2, '0')}</span>
                <a href={`/p/${it.id}`} className="home-wall-name">
                  {it.name}
                </a>
                <span className="home-wall-meta">
                  {it.partCount} 块
                  {it.sourceImage ? ' · 有原图' : ''}
                </span>
                <a href={`/p/${it.id}`} className="home-wall-go">
                  拆开
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
