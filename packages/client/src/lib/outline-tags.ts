// 大纲节点 `data.tags`（章 / 场景剧情线标签）的读侧窄化与预览条数（DESIGN.md `data-row`「章行的第三行」）。
// 窄化口径 = `data.tags` 非数组 → 空；只留非空字符串，不 trim / 不去重（服务端 `nodeTagsSchema`
// 已限长度与条数，展示层不改写用户文案）。预览条数固定，不按容器宽度量算。

/** 行内预览的标签条数上限（大纲树章行第三行 / 画布卡片第三行共用） */
export const OUTLINE_TAG_PREVIEW_LIMIT = 2;

/** `data.tags` → 标签数组：非数组 / 非字符串元素 / 空串一律丢弃 */
export function outlineTagsFromData(data: unknown): string[] {
  if (typeof data !== "object" || data === null) return [];
  const tags = (data as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter((tag): tag is string => typeof tag === "string" && tag !== "");
}

/** 预览切分：`visible` = 前 N 个，`overflow` = 未显示的条数（0 = 不需要 `+N`） */
export function previewOutlineTags(tags: readonly string[]): { visible: string[]; overflow: number } {
  const visible = tags.slice(0, OUTLINE_TAG_PREVIEW_LIMIT);
  return { visible, overflow: tags.length - visible.length };
}
