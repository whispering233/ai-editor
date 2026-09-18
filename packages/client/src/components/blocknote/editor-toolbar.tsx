// 常显写作工具条（卡 13.1，骨架）：章正文与参考资料正文共用——随块编辑器组件内置，两页自动获得
// （DESIGN.md §Components 的「唯一实现」）。契约：docs/ui/DESIGN.md §Components「写作面（工具条 / 专注模式）」
// ——几何 40px（4px 内边距 + 32px 档按钮）、底 = 正文底（跟 §Colors「写作面偏好」的纸张走）、
// 底部 1px 结构描边、无阴影、sticky 贴中栏内容区顶部；样式唯一入口 = 同目录 blocknote.css。
//
// 渲染位：作为 `BlockNoteView` 的 children —— 落在 `.bn-container` 内、contentEditable **之外**，
// 但在 BlockNoteContext + ComponentsContext 之内 ⇒ 这里既能拿 editor，也能直接用库自带的按钮组件
// （与本仓无 jsdom：库按钮的行为由浏览器走查承担，同 document-editor.tsx 的口径）。
// - 左侧 = 库自带按钮组装：它们无选中时各自回落到光标所在块，故常显可用；激活态由库管理。
// - 右侧撤销/重做自绘：库没有 `canUndo`，只有 `undo()` / `redo()` 返回「是否真的改了内容」
//   ⇒ **不做禁用态**（宁可点了没反应，也不要假禁用，见 DESIGN.md 同段落）。
// - 本文件不写色值 / 不写 `--bn-*` 覆盖 / 不拼接类名（守卫 design-discipline.test.ts）。
// - 卡 13.2：右端「写作设置」（撤销 / 重做之后）——偏好数据由 `DocumentEditor` 经 props 传入
//   （**不在这里再调 useWritingPrefs**：两份状态会互不同步）。
// - 卡 13.4：右端再加两段可选内容——`status`（状态区：章正文页的字数 · 保存态，13.6 的保存时间戳
//   复用同一位置）与 `focus`（专注模式开关）。两者都是页面注入：不传 = 不渲染（参考资料页因此天然
//   没有专注入口，见 DESIGN.md §Components「专注模式入口」）。
// - 卡 13.5：右端「写作设置」与「专注模式」之间再插「命令帮助」按钮（打开同目录 command-help.tsx 的
//   静态弹窗；与工具条按钮集同卡维护）。**开合状态就本组件持有**（弹窗受控、不进 store）。
import { useState, type ReactNode } from "react";
import {
  FontSizeOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  QuestionCircleOutlined,
  RedoOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  NestBlockButton,
  TextAlignButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
} from "@blocknote/react";
import type { WritingPrefs } from "../../hooks/use-writing-prefs";
import { CommandHelpDialog } from "./command-help";
import { WritingSettings } from "./writing-settings";

export interface EditorToolbarProps {
  /** 写作面偏好（全局一份，状态归 DocumentEditor 持有） */
  prefs: WritingPrefs;
  /** 单字段更新（写作设置下拉用） */
  setPref: <K extends keyof WritingPrefs>(key: K, value: WritingPrefs[K]) => void;
  /** 右侧最右端的状态区（章正文页：字数 · 保存态；专注模式下它是页头那行的唯一去处）——
   * 不传 = 不渲染（参考资料页的字数/保存态不在工具条） */
  status?: ReactNode;
  /** 专注模式开关（仅章正文页注入；不传 = 工具条不渲染专注按钮） */
  focus?: ToolbarFocus;
}

/** 专注模式开关（页面注入给工具条的那一份状态） */
export interface ToolbarFocus {
 /** 当前是否处于专注模式（决定按钮文案与图标） */
  active: boolean;
 /** 进入 / 退出（同一按钮切换） */
  onToggle: () => void;
}

export function EditorToolbar({ prefs, setPref, status, focus }: EditorToolbarProps) {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext();
  // 命令帮助弹窗的开合（本组件私有：弹窗受控，状态不往上传）
  const [helpOpen, setHelpOpen] = useState(false);
  // BlockNoteView 内必有 ComponentsContext（本组件只作为它的 children 用）；此守卫只为类型收敛
  if (components === undefined) return null;
  const { FormattingToolbar } = components;

  return (
    // 容器 = 库自带工具条表皮（ariakit：按钮的 ToolbarItem 上下文 + `bn-toolbar` 收窄按钮宽度/画激活态）；
    // `ai-writing-toolbar` 是本仓的覆写点（白底/阴影/滚动条外观 → blocknote.css）。
    <FormattingToolbar.Root className="ai-writing-toolbar bn-toolbar">
      {/* 块类型下拉 + 粗/斜/下/删（**不要 code**：本仓正文不展示代码样式）/ 颜色 / 对齐 / 缩进 / 链接 */}
      <BlockTypeSelect />
      <BasicTextStyleButton basicTextStyle="bold" />
      <BasicTextStyleButton basicTextStyle="italic" />
      <BasicTextStyleButton basicTextStyle="underline" />
      <BasicTextStyleButton basicTextStyle="strike" />
      <ColorStyleButton />
      <TextAlignButton textAlignment="left" />
      <TextAlignButton textAlignment="center" />
      <TextAlignButton textAlignment="right" />
      <NestBlockButton />
      <UnnestBlockButton />
      <CreateLinkButton />
      {/* 撑开左侧，把右端按钮推到工具条末尾（13.4/13.5 的命令帮助、专注模式接在这之后） */}
      <div className="flex-1" />
      <FormattingToolbar.Button
        label="撤销"
        mainTooltip="撤销"
        icon={<UndoOutlined />}
        onClick={() => editor.undo()}
      />
      <FormattingToolbar.Button
        label="重做"
        mainTooltip="重做"
        icon={<RedoOutlined />}
        onClick={() => editor.redo()}
      />
      <WritingSettings prefs={prefs} setPref={setPref}>
        <FormattingToolbar.Button label="写作设置" mainTooltip="写作设置" icon={<FontSizeOutlined />} />
      </WritingSettings>
      {/* 命令帮助（卡 13.5）：静态弹窗的入口——与撤销/重做同一套库按钮构件 */}
      <FormattingToolbar.Button
        label="命令帮助"
        mainTooltip="命令帮助"
        icon={<QuestionCircleOutlined />}
        onClick={() => setHelpOpen(true)}
      />
      <CommandHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      {/* 专注模式（仅章正文页注入）：同一按钮切换进/出，走与撤销/重做同一套库按钮构件
          （DESIGN.md §Components：入口收在工具条右端，不另起悬浮条） */}
      {focus !== undefined && (
        <FormattingToolbar.Button
          label={focus.active ? "退出专注" : "专注模式"}
          mainTooltip={focus.active ? "退出专注" : "专注模式"}
          icon={focus.active ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onClick={focus.onToggle}
        />
      )}
      {/* 状态区（右端最右）：字数 · 保存态——与页头说明行同一份文案，两处不同时显示 */}
      {status !== undefined && <div className="ml-2">{status}</div>}
    </FormattingToolbar.Root>
  );
}
