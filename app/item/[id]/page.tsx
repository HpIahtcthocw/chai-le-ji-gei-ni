import { notFound } from 'next/navigation';
import ExplodeScene from '@/components/ExplodeScene';
import { getItem, listItemIds } from '@/lib/items';

export async function generateStaticParams() {
  const ids = await listItemIds();
  return ids.map((id) => ({ id }));
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await getItem(id);
  if (!meta) notFound();
  return <ExplodeScene meta={meta} />;
}
