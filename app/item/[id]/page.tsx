import { redirect } from 'next/navigation';

/** 拼装那一版已经撤了：老链接统一落到拆件台 */
export default function ItemPage() {
  redirect('/live');
}
