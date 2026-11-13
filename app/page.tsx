import Link from 'next/link';
import { getItem, listItemIds } from '@/lib/items';

const STEPS = ['寄出', '拆分', '到货', '拼回', '猜', '导出'];

export default async function Home() {
  const ids = await listItemIds();
  const items = (await Promise.all(ids.map((id) => getItem(id)))).filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );

  return (
    <main className="entry-main">
      <div className="entry-wrap">
        <div className="rise" style={{ animationDelay: '0ms' }}>
          <div className="entry-overline">一件东西 · 拆成零件 · 寄过来</div>
          <h1 className="entry-title">拆了寄给你</h1>
          <p className="entry-lede">
            有人把一件东西拆成零件寄了过来。零件<b>一块一块到货</b>，你把它装回去，
            每装上一块就要猜一次：这到底是什么。拼完之后它会动一下，还能下载成可以打印的 STL。
          </p>

          <div className="entry-track">
            {STEPS.map((step, index) => (
              <span key={step} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                {index > 0 && <span className="seg" />}
                <span className="dot" />
                <span className="lab">{step}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="entry-list">
          {items.length === 0 && (
            <p style={{ padding: '32px 0', color: '#6d7688', fontSize: 13 }}>
              还没有可玩的物品。生成并拆分一件后，它会出现在这里。
            </p>
          )}
          {items.map((item, index) => (
            <Link
              key={item.id}
              href={`/item/${item.id}`}
              className="row rise"
              style={{ animationDelay: `${140 + index * 70}ms` }}
            >
              <span className="num">{String(index + 1).padStart(2, '0')}</span>
              <span>
                <span className="riddle">{item.riddle}</span>
                <span className="meta">
                  {item.partCount} 个零件 · 寄件人没有写名字，只留了这一句
                </span>
              </span>
              <span className="arrow">→</span>
            </Link>
          ))}
        </div>

        <p className="entry-foot">
          3D 资产由 Lux3D 生成并拆分 · 渲染由 aholo-viewer 驱动
        </p>
      </div>
    </main>
  );
}
