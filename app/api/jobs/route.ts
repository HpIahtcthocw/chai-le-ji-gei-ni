import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';
import { createJob, recentJobs } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ jobs: recentJobs(10).map(({ id, status, sender, createdAt }) => ({ id, status, sender, createdAt })) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { image?: string; sentence?: string; sender?: string; name?: string }
    | null;
  if (!body?.image || !/^https:\/\//.test(body.image)) {
    return NextResponse.json({ error: '需要一张已经上传成功的照片地址' }, { status: 400 });
  }
  const sentence = (body.sentence || '').trim().slice(0, 80);
  if (!sentence) return NextResponse.json({ error: '还没写那句话' }, { status: 400 });

  const job = createJob({
    image: body.image,
    sentence,
    sender: (body.sender || '').trim().slice(0, 12),
    name: (body.name || '无名件').trim().slice(0, 16),
  });

  // 生成是分钟级的活，不能占着请求；丢给独立进程，页面靠 /api/jobs/<id> 轮询
  const child = spawn(process.execPath, ['--env-file=.env.local', 'scripts/jobs/run.mjs', job.id], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return NextResponse.json({ id: job.id });
}
