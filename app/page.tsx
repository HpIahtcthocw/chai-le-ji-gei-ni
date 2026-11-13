import Link from 'next/link';
import { getItem, listItemIds } from '@/lib/items';

export default async function Home() {
  const ids = await listItemIds();
  const items = (await Promise.all(ids.map((id) => getItem(id)))).filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );

  return (
    <main style={{ minHeight: '100vh', padding: '64px 24px 48px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <h1 style={{ fontSize: 34, margin: 0, letterSpacing: 4, fontWeight: 500 }}>拆了寄给你</h1>
        <p style={{ margin: '18px 0 0', maxWidth: 520, lineHeight: 2, color: '#8f98a8', fontSize: 14 }}>
          有人把一件东西拆散寄了过来。零件会在你面前炸开，你一个个把它们装回去，每装上一块就要猜一次：
          这到底是什么。
        </p>

        <div style={{ marginTop: 56, borderTop: '1px solid #1d222c' }}>
          {items.length === 0 && (
            <p style={{ padding: '32px 0', color: '#6d7688', fontSize: 13 }}>
              还没有可玩的物品。生成并拆分一件后，它会出现在这里。
            </p>
          )}
          {items.map((item, index) => (
            <Link
              key={item.id}
              href={`/item/${item.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '48px minmax(0,1fr) 96px 24px',
                alignItems: 'center',
                gap: 16,
                padding: '26px 0',
                borderBottom: '1px solid #1d222c',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 12, color: '#5d6575', letterSpacing: 1 }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 16, color: '#e8eaf0' }}>{item.riddle}</span>
                <span style={{ display: 'block', fontSize: 12, color: '#6d7688', marginTop: 6, letterSpacing: 1 }}>
                  寄件人没有写名字，只留了一句话
                </span>
              </span>
              <span style={{ fontSize: 12, color: '#8f98a8', textAlign: 'right' }}>{item.partCount} 个零件</span>
              <span style={{ fontSize: 16, color: '#ffc98a', textAlign: 'right' }}>→</span>
            </Link>
          ))}
        </div>

        <p style={{ marginTop: 56, fontSize: 11, color: '#4d5566', letterSpacing: 1, lineHeight: 2 }}>
          3D 资产由 Lux3D 生成并拆分 · 渲染由 aholo-viewer 驱动
        </p>
      </div>
    </main>
  );
}
