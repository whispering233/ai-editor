// 快捷键清单与组合键文案（设置页「快捷键」tab 的唯一数据源）
// 契约 = DESIGN.md §设置页「快捷键」区：
// - 组合键文案按当前系统平台化（Apple = ⌘，其余 = Ctrl）——**不复用** `@blocknote/core` 的
//   `formatKeyboardShortcut`（那会把整块编辑器库拖进设置页 chunk），两者口径一致
// - 清单里的键位引用真实绑定用的常量（`save-shortcut.ts` 的 SAVE_SHORTCUT_KEY、
//   `panel-shortcuts.ts` 的 PANEL_SHORTCUT_KEY）：键位改了清单跟着改，禁止两处各写一份字面量
// - 界面缩放三键（Ctrl/Cmd + = / - / 0）的判定在主进程 `before-input-event`（不在渲染层），
//   这里只登记展示文案与可见性；档位阶梯见 `docs/design/50-desktop.md` §4.1
import { PANEL_SHORTCUT_KEY } from "./panel-shortcuts";
import { SAVE_SHORTCUT_KEY } from "./save-shortcut";

/** Apple 平台判定（纯函数，userAgent 注入以便单测；口径 = 库的 `formatKeyboardShortcut`） */
export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}

/** 组合键展示文案：修饰键按平台（Apple = ⌘），主键大写（`Ctrl + S` / `⌘ + S`）；带 Shift 时插在中间 */
export function formatShortcutKey(key: string, apple: boolean, shift = false): string {
  return `${apple ? "⌘" : "Ctrl"} + ${shift ? "Shift + " : ""}${key.toUpperCase()}`;
}

/** 清单项：`key` = 主键（`KeyboardEvent.key` 小写；修饰键恒为 Ctrl/Cmd） */
export interface ShortcutEntry {
  id: string;
  key: string;
  /** 组合键是否带 Shift（右栏整栏开关 = Ctrl/Cmd+Shift+B） */
  shift?: boolean;
  /** 仅桌面版生效：浏览器形态不登记展示（否则用户按了没反应会以为键坏了）；
   * 渲染侧按 `desktopBridge()` 非空过滤，与「通用」tab 同口径 */
  desktopOnly?: boolean;
  description: string;
}

/** 当前支持的快捷键（顺序 = 展示序）；键位引用真实绑定常量，见文件头 */
export const SHORTCUTS: readonly ShortcutEntry[] = [
  { id: "save", key: SAVE_SHORTCUT_KEY, description: "保存当前内容并生成本地存档" },
  { id: "toggle-sidebar", key: PANEL_SHORTCUT_KEY, description: "收起 / 展开左栏（桌面态）" },
  {
    id: "toggle-chat",
    key: PANEL_SHORTCUT_KEY,
    shift: true,
    description: "收起 / 展开右栏（桌面态）",
  },
  // 界面缩放（仅桌面形态）：键位判定在主进程，见文件头
  { id: "zoom-in", key: "=", desktopOnly: true, description: "放大界面" },
  { id: "zoom-out", key: "-", desktopOnly: true, description: "缩小界面" },
  { id: "zoom-reset", key: "0", desktopOnly: true, description: "界面缩放恢复 100%" },
];
