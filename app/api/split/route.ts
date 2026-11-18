import { NextResponse } from 'next/server';
import { isAllowedModelUrl, lux3d, pickGlb, taskPhase } from '@/lib/lux3d';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 提交拆件：只要一个官方 GLB 地址，返回任务号 */
export async function POST(req: Request) {
  const client = lux3d();
  if (!client) return NextResponse.json({ error: '没配密钥' }, { status: 503 });

  let glbUrl: string;
  try {
    const body = (await req.json()) as { glbUrl?: string };
    glbUrl = typeof body.glbUrl === 'string' ? body.glbUrl : '';
  } catch {
    return NextResponse.json({ error: '读不出模型地址' }, { status: 400 });
  }

  if (!isAllowedModelUrl(glbUrl)) {
    return NextResponse.json({ error: '模型地址不在白名单里' }, { status: 400 });
  }

  try {
    const taskId = await client.partSplit.create({ glbUrl });
    return NextResponse.json({ taskId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '提交拆件任务失败' },
      { status: 502 },
    );
  }
}

/** 查一次拆件状态，拆好就给出拆分后的 GLB 地址（浏览器直接吃 CDN，不经过我们） */
export async function GET(req: Request) {
  const client = lux3d();
  if (!client) return NextResponse.json({ error: '没配密钥' }, { status: 503 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺任务号' }, { status: 400 });

  try {
    const task = await client.tasks.retrieve(id);
    const phase = taskPhase(task.status);
    return NextResponse.json({
      phase,
      glbUrl: phase === 'done' ? pickGlb(task.outputs) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '查任务失败' },
      { status: 502 },
    );
  }
}
