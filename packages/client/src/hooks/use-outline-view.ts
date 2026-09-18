// 大纲页视图选择（`#/outline` 大纲树 / 章视图）的持久化（卡 18.3）。
// 为什么持久化：写作期会把章视图当常驻形态（跳进章正文再回大纲、刷新页面都还在章视图），
// 每次重选一次不符合持续写作的心智。**只记视图，不记「全部折叠」**——折叠态是一次性 session 态。
// 存储哲学同 use-theme / use-panels / use-writing-prefs：纯展示偏好、不进项目文件 / 备份 / 云同步。
// 读写防御：坏值 / 未知值 / 隐私模式 / SSR 异常一律回落 `tree`（偏好丢失不影响功能）。
// 契约：docs/ui/DESIGN.md §Components「大纲页双视图」、docs/design/config.md（key 清单）。
import { useState } from "react";

/** 页面形态：大纲树 / 章视图 */
export type OutlineView = "tree" | "chapters";

export const OUTLINE_VIEW_STORAGE_KEY = "ai-editor:outline-view";

/** 解析持久化值（纯函数，可单测）：只有 `"chapters"` 是章视图，其余（null / 空 / 坏值 / 未知值）回落大纲树 */
export function parseOutlineView(value: string | null): OutlineView {
  return value === "chapters" ? "chapters" : "tree";
}

/** 安全读取（隐私模式 / SSR → 默认）：读取本身也可能抛（部分浏览器的隐私模式） */
function readStored(): OutlineView {
  try {
    return parseOutlineView(window.localStorage.getItem(OUTLINE_VIEW_STORAGE_KEY));
  } catch {
    return "tree";
  }
}

/** 写入（配额 / 隐私模式失败静默——偏好丢失不影响功能） */
function writeStored(view: OutlineView): void {
  try {
    window.localStorage.setItem(OUTLINE_VIEW_STORAGE_KEY, view);
  } catch {
    /* 忽略 */
  }
}

/** 视图 state + 落盘：初值读 localStorage，切换即写回（页面只在切换处调本 hook） */
export function useOutlineView(): [OutlineView, (view: OutlineView) => void] {
  const [view, setView] = useState<OutlineView>(readStored);
  return [
    view,
    (next) => {
      setView(next);
      writeStored(next);
    },
  ];
}
