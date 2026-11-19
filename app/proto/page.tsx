import { readFile } from 'node:fs/promises';
import path from 'node:path';
import LockProto from '@/components/LockProto';

type Meta = { name: string; parts: { partId: string; label: string }[] };

export default async function ProtoPage() {
  const meta: Meta = JSON.parse(await readFile(path.join(process.cwd(), 'public/items/lamp/meta.json'), 'utf8'));
  const labels: Record<number, string> = {};
  for (const p of meta.parts) labels[Number(p.partId.replace('part-', ''))] = p.label;
  return (
    <LockProto
      src="/items/lamp/model-slim.glb"
      sender="小周"
      itemName={meta.name}
      labels={labels}
      message="宿舍熄灯以后，我靠它写完了最后一道题。毕业搬家带不走，寄给你了。"
    />
  );
}
