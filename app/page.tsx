import Link from 'next/link';
import HeroScene from '@/components/HeroScene';
import { getItem, listItemIds } from '@/lib/items';

export default async function Home() {
  const ids = await listItemIds();
  const items = (await Promise.all(ids.map((id) => getItem(id)))).filter(
    (item): item is NonNullable<typeof item> => Boolean(item),
  );
  const demo = items[0];

  return (
    <main className="hero-page">
      {demo && <HeroScene src={`/items/${demo.id}/model.glb`} />}

      <div className="hero-overlay">
        <div className="hero-top">
          <span>NO.07 · 寄件人不详</span>
          <span>AHOLO 3D AI HACKATHON 2026</span>
        </div>

        <div className="hero-bottom">
          <h1 className="hero-title">无名件</h1>
          <p className="hero-lede">
            有人把它拆成七块寄来。装完那一刻，它才真的有名字。
          </p>
          <div className="hero-actions">
            <Link href="/send" className="hero-enter">
              我也要寄一件
            </Link>
            {demo && (
              <Link href={`/p/${demo.id}`} className="hero-ghost">
                我收到一个包裹
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
