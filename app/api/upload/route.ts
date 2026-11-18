import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';

const GATEWAY = 'https://api.aholo.cn';
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 把浏览器选中的一张图传到 Aholo 资产库，返回可直接喂给 Lux3D 的公网 URL。
 * 凭证与上传任务必须在同一次请求内完成，换 token 去查旧任务会报“Token未绑定任务”。
 */
export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_DEMO === '1' || process.env.VERCEL === '1') {
    return NextResponse.json({ error: '线上版不接生成；寄一件要在本机跑' }, { status: 503 });
  }
  const key = process.env.AHOLO_API_KEY;
  if (!key) {
    return NextResponse.json({ error: '服务端没有配置 AHOLO_API_KEY' }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '请求体不是表单' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '缺少 file 字段' }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: '文件是空的' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '图片超过 5 MB，请先压缩' }, { status: 413 });
  }

  const tokenRes = await fetch(`${GATEWAY}/asset/v1/token`, {
    headers: { Authorization: key },
    cache: 'no-store',
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ error: `取上传凭证失败：${tokenRes.status}` }, { status: 502 });
  }
  const cred = (await tokenRes.json()) as {
    ousToken?: string;
    globalDomain?: string;
    blockSize?: number;
  };
  if (!cred.ousToken || !cred.globalDomain) {
    return NextResponse.json({ error: '上传凭证字段不完整' }, { status: 502 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const md5 = createHash('md5').update(bytes).digest('hex');
  const name = file.name || 'upload.jpg';

  const body = new FormData();
  body.append('file', new Blob([bytes], { type: file.type || 'application/octet-stream' }), name);
  body.append('md5', md5);
  body.append('size', String(file.size));
  body.append('name', name);

  const upRes = await fetch(`${cred.globalDomain}/ous/api/v2/single/upload`, {
    method: 'POST',
    headers: { 'ous-token-v2': cred.ousToken },
    body,
  });
  if (!upRes.ok) {
    return NextResponse.json({ error: `上传失败：${upRes.status}` }, { status: 502 });
  }
  const upJson = (await upRes.json()) as { c?: string; d?: { obsTaskId?: string } };
  const taskId = upJson.d?.obsTaskId;
  if (!taskId) {
    return NextResponse.json({ error: '上传没有返回任务号' }, { status: 502 });
  }

  // 轮询上传状态；成功终态是 status=5，此时 d.url 就是公网地址
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 300));
    const stRes = await fetch(
      `${cred.globalDomain}/ous/api/v2/upload/status?taskId=${encodeURIComponent(taskId)}`,
      { headers: { 'ous-token-v2': cred.ousToken }, cache: 'no-store' },
    );
    if (!stRes.ok) continue;
    const st = (await stRes.json()) as { d?: { status?: number; url?: string } };
    if (st.d?.status === 5 && st.d.url) {
      return NextResponse.json({ url: st.d.url, bytes: file.size });
    }
  }

  return NextResponse.json({ error: '上传超时，稍后重试' }, { status: 504 });
}
