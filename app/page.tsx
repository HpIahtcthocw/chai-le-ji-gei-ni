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
    <main className="home-paper">
      <div className="home-stage">
        {demo && <HeroScene src={`/items/${demo.id}/model.glb`} />}
        <div className="home-dots" aria-hidden="true" />
      </div>

      <div className="home-rule home-rule-top">
        <span>AHOLO 3D AI HACKATHON</span>
        <span>NO.07 / UNCLAIMED</span>
      </div>

      <div className="home-copy">
        <h1 className="home-title">无名件</h1>
        <p className="home-lede">
          拆成七块，一块一块寄出去。<br />
          收件人拼回去，才认得出它是什么。
        </p>
        <div className="home-actions">
          <Link href="/send" className="home-cta">
            寄一件
          </Link>
          {demo && (
            <Link href={`/p/${demo.id}`} className="home-alt">
              我收到一个包裹
            </Link>
          )}
        </div>
      </div>

      <div className="home-rule home-rule-bottom">
        <span>7 PARTS · STL</span>
        <span>{demo ? demo.riddle : ''}</span>
      </div>
    </main>
  );
}
