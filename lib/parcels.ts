/**
 * 一个包裹 = 一件资产 + 寄件人 + 一张原图。
 * 不做数据库：整条信息塞进链接本身，收件人打开链接就够还原，部署到哪都能用。
 */
export type Parcel = {
  /** 资产 id，对应 public/items/<a>/ */
  a: string;
  /** 寄件人署名，可空 */
  s?: string;
  /** 寄件人上传的原图地址，可空 */
  i?: string;
  /** 创建时间戳 */
  t: number;
  /** 夹在核心零件里那句话；没有就回落到 meta.story */
  m?: string;
};

const ID_RE = /^[a-z0-9_-]+$/i;

export function encodeParcel(parcel: Parcel): string {
  return Buffer.from(JSON.stringify(parcel), 'utf8').toString('base64url');
}

/** 链接里既可能是打包过的 code，也可能直接就是资产 id（方便本地调试） */
export function parseParcel(code: string): Parcel | null {
  // 先按打包 code 解：base64url 的字符集和资产 id 完全重叠，顺序反过来会误伤
  try {
    const parsed = JSON.parse(Buffer.from(code, 'base64url').toString('utf8')) as Parcel;
    if (parsed && typeof parsed.a === 'string' && ID_RE.test(parsed.a)) {
      return { ...parsed, t: Number(parsed.t) || 0 };
    }
  } catch {
    // 不是打包 code，继续按资产 id 试
  }
  if (code.length <= 32 && ID_RE.test(code)) {
    return { a: code, t: 0 };
  }
  return null;
}
