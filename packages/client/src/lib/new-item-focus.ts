// 新建条目聚焦（A2，用户反馈 #1：新建后焦点自动落到新建内容）
// 纯 DOM 动作：按选择器定位行元素 → 滚动到视口中部 → 聚焦（行元素需 tabIndex=-1 才可聚焦）。
// 调用方在数据刷新完成的下一帧调用，并自持「临时高亮」state（3s 消失，各页既有机制）。
// 目标不在当前视图（分页/筛选/排序未命中）→ 返回 false，调用方忽略（不强行跳页）。
export function focusNewItem(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  return true;
}
