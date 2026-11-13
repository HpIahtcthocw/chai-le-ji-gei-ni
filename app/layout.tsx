import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '拆了寄给你',
  description: '一件物品被拆成零件，你把它拼回去，每拼一块猜一次这是什么。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: '#0f1115', color: '#e8eaf0', fontFamily: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
