'use client';

import { useState } from 'react';

/**
 * 首页那个“拆开它”的按钮。
 * 直接推给 3D 场景一个开合进度，不靠滚动——评委不用先学会滚页面才能看到拆件。
 */
export default function OpenButton() {
  const [open, setOpen] = useState(false);

  const toggle = () => {
    const fn = open ? (window as any).__HERO_RESET__ : (window as any).__HERO_OPEN__;
    fn?.();
    document.documentElement.dataset.open = open ? '0' : '1';
    setOpen(!open);
  };

  return (
    <button type="button" className="home-cta" onClick={toggle} aria-pressed={open}>
      {open ? '装回去' : '拆开它'}
    </button>
  );
}
