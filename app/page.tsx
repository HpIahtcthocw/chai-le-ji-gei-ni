export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: 32, margin: '0 0 12px' }}>拆了寄给你</h1>
        <p style={{ lineHeight: 1.7, color: '#9aa3b2' }}>
          一件物品被拆成零件，零件在屏幕上炸开。你把它们拼回去，每拼一块都要猜一次——这到底是什么。
        </p>
        <p style={{ lineHeight: 1.7, color: '#9aa3b2' }}>
          物品选择页在主流程开发中。当前可用的是渲染管道实验页 <a href="/lab" style={{ color: '#7fb2ff' }}>/lab</a>。
        </p>
      </div>
    </main>
  );
}
