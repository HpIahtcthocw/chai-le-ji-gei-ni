'use client';

import Link from 'next/link';
import HeroScene from '@/components/HeroScene';

export default function ShowPage() {
  return (
    <main className="hero-page">
      <HeroScene />

      <div className="hero-overlay">
        <div className="hero-top">
          <span>NO.07 · 寄件人不详</span>
          <span>AHOLO 3D AI HACKATHON 2026</span>
        </div>

        <div className="hero-bottom">
          <h1 className="hero-title">拆了寄给你 · 无名件</h1>
          <p className="hero-lede">有人把它拆成七块寄来。装完那一刻，它才真的有名字。</p>
          <Link href="/live" className="hero-enter">
            进去拆一件
          </Link>
        </div>
      </div>
    </main>
  );
}
