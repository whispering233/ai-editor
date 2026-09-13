// 标签 tint 分配（DESIGN.md §Colors「标签色」分配规则）：按文案做 FNV-1a 哈希取模 5，同名恒同色。
// 为什么用哈希而不是语义色表：标签名来自用户数据（`data.tags`/分类自由文本），无法穷举；
// 哈希保证「同一标签在任何页面任何时间都是同一个色」，既不随机也不会随着列表顺序漂移。
// 色值只在 index.css 的 `--tag-*` 段定义，本文件只做「名字 → 色调类名」的映射。

/** 色调名（与 index.css `--tag-*` / Tailwind `bg-tag-*` 一一对应） */
export const TAG_TINTS = ["sky", "ice", "mint", "sage", "yellow"] as const;
export type TagTint = (typeof TAG_TINTS)[number];

/** FNV-1a 32 位哈希（纯函数、跨平台稳定：不依赖 String#hashCode 等实现相关行为） */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 色调名 → Tailwind 底色类（**静态字面量表**）：Tailwind 只在源码里扫字面量类名，
 * `bg-tag-${x}` 这种拼接出来的类不会被生成（实测：类名在 DOM 上但样式不存在 → 底色透明）。
 * 因此这里是「色调 → 类名」的唯一映射表，新增色调必须同时在本表与 index.css 登记。*/
const TINT_CLASS: Record<TagTint, string> = {
  sky: "bg-tag-sky",
  ice: "bg-tag-ice",
  mint: "bg-tag-mint",
  sage: "bg-tag-sage",
  yellow: "bg-tag-yellow",
};

/** 文案 → 色调名（空串/空白也稳定：回落到首色，不抛错——调用点不该为此写守卫） */
export function tagTint(text: string): TagTint {
  const key = text.trim();
  if (key === "") return TAG_TINTS[0];
  return TAG_TINTS[fnv1a(key) % TAG_TINTS.length];
}

/** 文案 → Tailwind 底色类（`bg-tag-*`；色值定义在 index.css） */
export function tagTintClass(text: string): string {
  return TINT_CLASS[tagTint(text)];
}
