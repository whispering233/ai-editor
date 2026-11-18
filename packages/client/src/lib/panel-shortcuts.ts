// 整栏快捷键（卡 L2）：桌面态 Ctrl/Cmd+B 切左栏、Ctrl/Cmd+Shift+B 切右栏
// 契约 = DESIGN.md §Layout「三栏」子条「整栏开关锚定视口顶带两角」末句：与顶带两角的两枚开关
// 同一动作；焦点在输入框 / 块编辑器内**不抢键**（块编辑器的 Mod+B 是加粗）。
// 键位常量同时被设置页「快捷键」清单引用，键位改了清单跟着改，禁止两处各写一份字面量。

/** 整栏快捷键主键（`KeyboardEvent.key` 小写；设置页「快捷键」清单的唯一键位来源） */
export const PANEL_SHORTCUT_KEY = "b";

/** 快捷键目标栏：sidebar = 左栏、chat = 右栏 */
export type PanelShortcutPanel = "sidebar" | "chat";

/** 可编辑区：命中即不抢键（输入框 / 文本域 / 块编辑器的 contenteditable） */
const EDITABLE_TARGET_SELECTOR = "input, textarea, [contenteditable='true']";

/** 事件目标的最小结构（= DOM `Element.closest` 的形状；只需区分命中 / 未命中） */
type ShortcutTarget = { closest(selector: string): object | null };

/** 事件目标是否落在可编辑区（只取 closest，参数用结构类型以便 node 单测） */
export function isEditableShortcutTarget(target?: ShortcutTarget | null): boolean {
  return target?.closest(EDITABLE_TARGET_SELECTOR) != null;
}

/**
 * 整栏快捷键判定：Ctrl 或 Cmd + B（Alt 组合不算），带 Shift → 右栏，否则左栏。
 * 可编辑区内返回 null（块编辑器保留 Mod+B 加粗）。
 */
export function panelShortcutFor(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target?: ShortcutTarget | null;
}): PanelShortcutPanel | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key.toLowerCase() !== PANEL_SHORTCUT_KEY) return null;
  if (isEditableShortcutTarget(e.target)) return null;
  return e.shiftKey ? "chat" : "sidebar";
}
