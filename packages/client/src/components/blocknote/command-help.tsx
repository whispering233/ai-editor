// 「命令帮助」弹窗（卡 13.5）：工具条右端入口打开的静态文档——用途 = 「不让用户猜命令」的兜底
// （docs/ui/DESIGN.md §Components 的 `command-help` 条：与工具条按钮集**同卡维护**，加按钮就补条目）。
//
// 三条口径：
// ① 条目只列**真实存在**的入口：工具条按钮集（顺序与 editor-toolbar.tsx 一致）、编辑器内建的
//    斜杠菜单 / 添加块按钮 / 块手柄（库默认开启，本仓没关）、以及库 keymap 里确有的快捷键。
// ② 文案单源：库按钮与库菜单项的名字取库字典（`zh.formatting_toolbar.*.tooltip`、
//    `zh.slash_menu.*.title`、`zh.side_menu.*`、`zh.drag_handle.*`、`zh.placeholders.default`），
//    快捷键取 `zh.formatting_toolbar.*.secondary_tooltip` 经 `formatKeyboardShortcut` 平台化
//    （Mac = ⌘B、Windows / Linux = Ctrl+B）——**不手抄**，换库版本即随动。
//    两处字典里没有、只能取字面量（缺证不写，两条都已在装包产物里核实过）：
//    - 撤销 / 重做：`@blocknote/core` 0.54.2 的 KeyboardShortcutsExtension
//      （`src/extensions/tiptap-extensions/KeyboardShortcuts/KeyboardShortcutsExtension.ts`，
//      编译进 `dist/src-Buuo5l7X.js`）的 keymap：`"Mod-z"` → `editor.undo()`，
//      `"Mod-y"` / `"Shift-Mod-z"` → `editor.redo()`。键名字法在这里取字典的展示风格（`Mod+B`，
//      加号 + 大写）而非 prosemirror 的 `Mod-z`（连字符 + 小写）——键位本身没变，只统一写法。
//    - 本仓自绘的五个按钮名（撤销 / 重做 / 保存 / 写作设置 / 专注模式，卡 14.1 加「保存」）：与
//      editor-toolbar.tsx 的 label 手工同值（DESIGN.md 的「同卡维护」指的就是这里；库字典里没有任何
//      一条是它们）。
//    - 「保存」的说明里的自动保存时长**从 `AUTOSAVE_DELAY_MS` 插值**（不复述数字：改常量则文案随动，
//      同 AGENTS.md「数值单源」纪律）。
// ③ 样式只走 antd token / Tailwind 语义类：无硬编码色值 / 无 `!` 前缀类 / 无拼接类名
//    （守卫 design-discipline.test.ts）。
// 渲染位：`CommandHelpDialog` 是受控叶子（复用 components/ui/dialog.tsx，Esc / 遮罩 / 右上角关闭都由它兜住）；
// 开合状态由工具条持有（本仓弹窗一律受控，不在 store 里另存一份）。
import { formatKeyboardShortcut } from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import { blockTypeSelectItems } from "@blocknote/react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { AUTOSAVE_DELAY_MS } from "../../lib/manuscript";

/** 一条帮助条目 */
export interface CommandHelpEntry {
  /** 入口 / 命令名（库按钮与库菜单项一律取库字典文案；本仓自绘的四个按钮见文件头 ② 的例外） */
  name: string;
  /** 平台化后的快捷键文案（无快捷键的入口不写） */
  shortcut?: string;
  /** 一句话补充说明（斜杠菜单 / 添加块按钮 / 块手柄这类不是按钮的入口用） */
  note?: string;
}

/** 一个帮助分组（本工具条 / 编辑器内 / 快捷键） */
export interface CommandHelpSection {
  title: string;
  entries: CommandHelpEntry[];
}

/** 字典里的快捷键原文 → 平台化文案（第二参数与库自身的调用一致：`generic.ctrl_shortcut`） */
function shortcut(raw: string): string {
  return formatKeyboardShortcut(raw, zh.generic.ctrl_shortcut);
}

/**
 * 帮助内容 = 唯一数据源（弹窗与 `command-help.test.ts` 都消费它）。
 * 工具条的块类型下拉取自库的 `blockTypeSelectItems(zh)`：字面跟随库那份清单，不在本仓另抄一遍。
 */
export function commandHelpSections(): CommandHelpSection[] {
  const toolbar = zh.formatting_toolbar;
  const dict = zh.slash_menu;
  return [
    {
      title: "写作工具条",
      entries: [
        {
          name: "块类型下拉",
          note: blockTypeSelectItems(zh)
            .map((item) => item.name)
            .join(" / "),
        },
        { name: toolbar.bold.tooltip },
        { name: toolbar.italic.tooltip },
        { name: toolbar.underline.tooltip },
        { name: toolbar.strike.tooltip },
        { name: toolbar.colors.tooltip },
        {
          name: "对齐",
          note: `${toolbar.align_left.tooltip} / ${toolbar.align_center.tooltip} / ${toolbar.align_right.tooltip}`,
        },
        { name: `${toolbar.nest.tooltip} / ${toolbar.unnest.tooltip}` },
        { name: toolbar.link.tooltip },
        { name: "撤销 / 重做" },
        {
          name: "保存",
          note: `立即把当前正文落盘；平时停止输入约 ${AUTOSAVE_DELAY_MS / 1000}s 会自动保存`,
        },
        {
          name: "写作设置",
          note: "字体 · 字号 · 行高 · 纸张 · 纹理 · 段首缩进",
        },
        {
          name: "专注模式",
          note: "仅章正文页；再点一次或按 Esc 退出",
        },
      ],
    },
    {
      title: "编辑器内",
      entries: [
        {
          name: "斜杠菜单",
          note: `${zh.placeholders.default}：${[
            dict.heading.title,
            dict.quote.title,
            dict.bullet_list.title,
            dict.code_block.title,
            dict.table.title,
            dict.image.title,
            dict.divider.title,
          ].join(" · ")} 等`,
        },
        {
          name: zh.side_menu.add_block_label,
          note: "块左侧的 ＋：在光标处打开斜杠菜单插入新块",
        },
        {
          name: "块手柄",
          note: `块左侧的手柄：按住拖拽排序；点击打开菜单（${zh.drag_handle.delete_menuitem} · ${zh.drag_handle.colors_menuitem}）`,
        },
      ],
    },
    {
      title: "快捷键",
      entries: [
        { name: toolbar.bold.tooltip, shortcut: shortcut(toolbar.bold.secondary_tooltip) },
        { name: toolbar.italic.tooltip, shortcut: shortcut(toolbar.italic.secondary_tooltip) },
        {
          name: toolbar.underline.tooltip,
          shortcut: shortcut(toolbar.underline.secondary_tooltip),
        },
        { name: toolbar.strike.tooltip, shortcut: shortcut(toolbar.strike.secondary_tooltip) },
        { name: toolbar.link.tooltip, shortcut: shortcut(toolbar.link.secondary_tooltip) },
        { name: toolbar.nest.tooltip, shortcut: shortcut(toolbar.nest.secondary_tooltip) },
        { name: toolbar.unnest.tooltip, shortcut: shortcut(toolbar.unnest.secondary_tooltip) },
        // 字典没有撤销 / 重做（见文件头 ② 的出处）：keymap 原文 = `Mod-z` / `Mod-y`
        { name: "撤销", shortcut: shortcut("Mod+Z") },
        { name: "重做", shortcut: shortcut("Mod+Y") },
      ],
    },
  ];
}

export interface CommandHelpDialogProps {
  /** 是否打开（受控：状态归工具条） */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 「命令帮助」弹窗（受控叶子；工具条的「命令帮助」按钮打开它） */
export function CommandHelpDialog({ open, onOpenChange }: CommandHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>命令帮助</DialogTitle>
          <DialogDescription>
            写作工具条上的入口，以及编辑器内建的命令；快捷键按当前系统显示（Mac = ⌘，Windows / Linux =
            Ctrl）。
          </DialogDescription>
        </DialogHeader>
        {commandHelpSections().map((section) => (
          <section key={section.title} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
            <ul className="flex flex-col gap-1.5">
              {section.entries.map((entry) => (
                <li key={entry.name} className="flex items-start justify-between gap-4">
                  <span className="flex flex-col">
                    {/* 名称沿用弹窗正文的 text-sm（DialogContent 已定档），只有补充说明降一档 */}
                    <span>{entry.name}</span>
                    {entry.note !== undefined && (
                      <span className="text-xs text-muted-foreground">{entry.note}</span>
                    )}
                  </span>
                  {entry.shortcut !== undefined && (
                    <kbd className="shrink-0 text-xs text-muted-foreground">{entry.shortcut}</kbd>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
