import { NextResponse } from 'next/server';
import { lux3d, pickGlb, taskPhase } from '@/lib/lux3d';

export const runtime = 'nodejs';
// 只做「提交」和「查一次」，两件事都是秒级；分钟级的等待交给前端轮询
export const maxDuration = 60;

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_BYTES = 4_000_000;

/** 提交一张照片，立刻拿回任务号；不落盘、不等待 */
export async function POST(req: Request) {
  const client = lux3d();
  if (!client) {
    return NextResponse.json({ error: '这台机器没配 AHOLO_API_KEY，生成开不了' }, { status: 503 });
  }

  let img: string;
  try {
    const body = (await req.json()) as { img?: string };
    img = typeof body.img === 'string' ? body.img : '';
  } catch {
    return NextResponse.json({ error: '读不出照片' }, { status: 400 });
  }

  if (!DATA_URL.test(img)) {
    return NextResponse.json({ error: '照片格式不对，要 jpeg / png / webp 的 base64' }, { status: 400 });
  }
  if (img.length > MAX_BYTES) {
    return NextResponse.json({ error: '照片太大，压到 2MB 以内再传' }, { status: 413 });
  }

  try {
    const taskId = await client.imgTo3d.create({
      img,
      version: 'G1',
      faceCount: 120000,
      outputFormat: ['glb'],
      enablePbr: true,
      aiPredictSize: true,
    });
    return NextResponse.json({ taskId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '提交生成任务失败' },
      { status: 502 },
    );
  }
}

/** 查一次状态：前端每 3 秒来一趟，每次都是短请求 */
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
