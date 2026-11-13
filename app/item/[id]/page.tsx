import { notFound } from 'next/navigation';
import GameScene from '@/components/GameScene';
import { getItem, listItemIds } from '@/lib/items';

export async function generateStaticParams() {
  const ids = await listItemIds();
  return ids.map((id) => ({ id }));
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await getItem(id);
  if (!meta) notFound();
  return <GameScene meta={meta} />;
}
