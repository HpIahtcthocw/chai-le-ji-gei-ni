import { redirect } from 'next/navigation';

// 首页直接进拆件台：那台旧窗口才是这个项目的正门
export default function Home() {
  redirect('/live');
}
