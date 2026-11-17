import { NextResponse } from 'next/server';
import { readJob } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = readJob(id);
  if (!job) return NextResponse.json({ error: '没有这个任务' }, { status: 404 });
  return NextResponse.json(job);
}
