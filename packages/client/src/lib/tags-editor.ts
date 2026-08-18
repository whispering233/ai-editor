// 标签列表编辑器（TagsEditor）纯函数（批次六 M1，2026-08 用户反馈）
// 契约：doc/ui/pages/entity-detail.md「标签列表编辑器」——行内输入框回车 = 添加下一项：
//   非末行 → 聚焦下一行；末行且非空 → 追加空行并聚焦新行；末行且为空 → 无操作（防空行跑马灯）。
// 纯函数化便于 vitest 覆盖（client 包无 jsdom，交互逻辑下沉 lib 测试，组件仅薄封装）。

/** 回车行为决策结果：append = 是否需要追加空行；focusIndex = 回车后应聚焦的输入框下标 */
export interface TagEnterBehavior {
  append: boolean;
  focusIndex: number;
}

/**
 * 回车行为决策（M1）：给定标签数组与当前行下标，返回应执行的行为；null = 无操作。
 * - 非末行：不追加，聚焦下一行（连续输入流「回车添加下一项」）
 * - 末行且当前值非空：追加空行（下标 = values.length）并聚焦
 * - 末行且当前值为空：null（避免回车跑马灯式产生空行）
 * 防御：下标越界（values 为空或 index 非法）→ null，组件层不应出现
 */
export function enterBehavior(values: readonly string[], index: number): TagEnterBehavior | null {
  if (index < 0 || index >= values.length) return null;
  if (index < values.length - 1) return { append: false, focusIndex: index + 1 };
  if (values[index].trim() !== "") return { append: true, focusIndex: values.length };
  return null;
}

/**
 * 数组元素移动（M3，2026-08 批次六）：from 位移到 to 位（其余元素顺移），返回新数组。
 * 拖拽排序用——from === to（原地放下）或下标越界 → 原样返回副本（防御，不抛错）。
 */
export function moveArrayItem(values: readonly string[], from: number, to: number): string[] {
  if (from === to) return [...values];
  if (from < 0 || from >= values.length || to < 0 || to >= values.length) return [...values];
  const next = [...values];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
