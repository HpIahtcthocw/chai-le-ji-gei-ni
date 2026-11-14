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
    <main className="home-scroll">
      <div className="home-fix">
        <div className="home-stage">
          {demo && <HeroScene src={`/items/${demo.id}/model.glb`} />}
          <div className="home-dots" aria-hidden="true" />
          <div className="home-shadow" aria-hidden="true" />
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

        <ol className="home-manifest" aria-hidden="true">
          <li><i>01</i><span>罩住光的</span></li>
          <li><i>02</i><span>会发烫的</span></li>
          <li><i>03</i><span>伸出去的那截</span></li>
          <li><i>04</i><span>让它转身的</span></li>
          <li><i>05</i><span>撑起它的</span></li>
          <li><i>06</i><span>托住它的</span></li>
          <li><i>07</i><span>连着的</span></li>
        </ol>
        <div className="home-hint" aria-hidden="true">
          <span>往下滚</span>
          <i />
        </div>
      </div>

      <div className="home-track" aria-hidden="true" />
    </main>
  );
}
