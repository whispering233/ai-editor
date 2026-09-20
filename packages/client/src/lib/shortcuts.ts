// 快捷键清单与组合键文案（设置页「快捷键」tab 的唯一数据源）
// 契约 = DESIGN.md §设置页「快捷键」区：
// - 组合键文案按当前系统平台化（Apple = ⌘，其余 = Ctrl）——**不复用** `@blocknote/core` 的
//   `formatKeyboardShortcut`（那会把整块编辑器库拖进设置页 chunk），两者口径一致
// - 清单里的键位引用真实绑定用的常量（`save-shortcut.ts` 的 SAVE_SHORTCUT_KEY）：
//   键位改了清单跟着改，禁止两处各写一份字面量
import { SAVE_SHORTCUT_KEY } from "./save-shortcut";

/** Apple 平台判定（纯函数，userAgent 注入以便单测；口径 = 库的 `formatKeyboardShortcut`） */
export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}

/** 组合键展示文案：修饰键按平台（Apple = ⌘），主键大写（`Ctrl + S` / `⌘ + S`） */
export function formatShortcutKey(key: string, apple: boolean): string {
  return `${apple ? "⌘" : "Ctrl"} + ${key.toUpperCase()}`;
}

/** 清单项：`key` = 主键（`KeyboardEvent.key` 小写；修饰键恒为 Ctrl/Cmd） */
export interface ShortcutEntry {
  id: string;
  key: string;
  description: string;
}

/** 当前支持的快捷键（顺序 = 展示序）；键位引用真实绑定常量，见文件头 */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  { id: "save", key: SAVE_SHORTCUT_KEY, description: "保存当前内容并生成本地存档" },
];
