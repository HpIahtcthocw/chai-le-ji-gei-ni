'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Job } from '@/lib/jobs';

const STATE_TEXT: Record<string, string> = { wait: '还没到', run: '正在做', done: '好了', fail: '停在这里' };

export default function JobView({ id }: { id: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${id}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('任务读不到');
        const json = (await res.json()) as Job;
        if (stopped) return;
        setJob(json);
        if (json.status !== 'done' && json.status !== 'failed') timer = window.setTimeout(tick, 1500);
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err.message : '出错了');
        timer = window.setTimeout(tick, 3000);
      }
    };
    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [id]);

  const done = job?.status === 'done' && job.code;
  const failed = job?.status === 'failed';

  return (
    <main className="job-page">
      <div className="job-inner">
        <div className="job-top">
          <Link href="/send" className="send-back">← 重新寄一件</Link>
          <div className="send-step">寄件 · 02 生成</div>
        </div>

        <h1 className="job-title">{done ? '盒子合上了' : failed ? '这一段没走通' : '正在长出你的那件东西'}</h1>
        <p className="job-lead">
          {done ? '零件已经装好了。把链接发给收件人，剩下的事由他动手。' : '这一步是真的在生成：先长形状，再按结构拆成零件。几分钟到十几分钟，别关这一页。'}
        </p>

        {job?.image && (
          <figure className="job-source">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={job.image} alt="寄出的那张照片" />
            <figcaption>{job.sentence}</figcaption>
          </figure>
        )}

        <ol className="job-steps">
          {(job?.steps ?? []).map((step) => (
            <li key={step.key} className={`job-step is-${step.state}`}>
              <span className="job-dot" aria-hidden />
              <span className="job-name">{step.label}</span>
              <span className="job-note">{step.note || STATE_TEXT[step.state]}</span>
            </li>
          ))}
        </ol>

        {error && <p className="job-error">{error}</p>}
        {failed && job?.error && <p className="job-error">原因：{job.error}</p>}

        {done && (
          <div className="job-actions">
            <Link className="job-primary" href={`/p/${encodeURIComponent(job!.code!)}`}>打开包裹</Link>
            <Link className="job-ghost" href={`/s/${encodeURIComponent(job!.code!)}`}>先看装盒页</Link>
          </div>
        )}
      </div>
    </main>
  );
}
