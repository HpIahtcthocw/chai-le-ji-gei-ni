import Link from 'next/link';
import { getItem, listItemIds } from '@/lib/items';

export default async function Home() {
  const ids = await listItemIds();
  const items = (await Promise.all(ids.map((id) => getItem(id)))).filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );

  return (
    <main style={{ minHeight: '100vh', padding: 'clamp(40px,8vw,64px) 20px 48px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <h1 style={{ fontSize: 'clamp(26px,6vw,34px)', margin: 0, letterSpacing: 4, fontWeight: 500 }}>
          拆了寄给你
        </h1>
        <p style={{ margin: '18px 0 0', maxWidth: 520, lineHeight: 2, color: '#8f98a8', fontSize: 14 }}>
          有人把一件东西拆成零件寄了过来。零件一块一块到货，你把它装回去，
          <span style={{ color: '#e8eaf0' }}>每装上一块就要猜一次：这到底是什么</span>。
          拼完之后它会动一下，还能下载成可以打印的 STL。
        </p>

        <div style={{ marginTop: 'clamp(32px,6vw,56px)', borderTop: '1px solid #1d222c' }}>
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
                gridTemplateColumns: '28px minmax(0,1fr) 22px',
                alignItems: 'center',
                gap: 14,
                padding: 'clamp(18px,4vw,26px) 0',
                borderBottom: '1px solid #1d222c',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 12, color: '#5d6575', letterSpacing: 1 }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>
                <span style={{ display: 'block', fontSize: 16, color: '#e8eaf0', lineHeight: 1.7 }}>
                  {item.riddle}
                </span>
                <span style={{ display: 'block', fontSize: 12, color: '#6d7688', marginTop: 6, letterSpacing: 1 }}>
                  {item.partCount} 个零件 · 寄件人没有写名字，只留了这一句
                </span>
              </span>
              <span style={{ fontSize: 16, color: '#ffc98a', textAlign: 'right' }}>→</span>
            </Link>
          ))}
        </div>

        <p style={{ marginTop: 'clamp(32px,6vw,56px)', fontSize: 11, color: '#4d5566', letterSpacing: 1, lineHeight: 2 }}>
          3D 资产由 Lux3D 生成并拆分 · 渲染由 aholo-viewer 驱动
        </p>
      </div>
    </main>
  );
}
