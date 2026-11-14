'use client';

import { useState } from 'react';

export default function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button type="button" className="share-copy" onClick={copy}>
      {copied ? '已复制' : '复制链接'}
    </button>
  );
}
