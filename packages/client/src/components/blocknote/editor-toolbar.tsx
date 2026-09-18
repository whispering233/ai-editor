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
import { RedoOutlined, UndoOutlined } from "@ant-design/icons";
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

export function EditorToolbar() {
  const editor = useBlockNoteEditor();
  const components = useComponentsContext();
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
      {/* 撑开左侧，把右端按钮推到工具条末尾（13.2–13.5 的写作设置/命令帮助/专注模式接在这之后） */}
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
    </FormattingToolbar.Root>
  );
}
