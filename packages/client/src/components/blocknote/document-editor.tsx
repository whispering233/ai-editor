// 块编辑器封装（卡 12.5）：章正文与参考资料正文共用（12.8 复用同一组件）。
// - 编辑器实例 = @blocknote/react 的 useCreateBlockNote —— **初始内容只在挂载时消费一次**
//   （BlockNote 非受控：外部改写内容必须换 key 重挂，见 pages/Manuscript.tsx 的 editorEpoch）
// - 视图 = @blocknote/ariakit 变体（DESIGN.md §Colors「块编辑器」登记的第二套表皮；样式随该包引入）
// - 常显写作工具条（卡 13.1）= 本组件的 children（EditorToolbar）：children 落在 `.bn-container` 内、
//   contentEditable **之外**（仍在 BlockNoteContext + ComponentsContext 之内），靠 blocknote.css 的
//   flex `order:-1` 提到编辑器上方；选中文字时的**浮动**工具条保持默认开启（两者并存，DESIGN.md 有意）
// - 改色唯一入口 = 同目录 blocknote.css（调用点不得写 --bn-* 覆盖或内联色值）
// - 导入导出（卡 12.6）：md ↔ 块的互转要实例才做得了，经 `DocumentEditorApi`（onReady 回调）递给页面；
//   纯函数层 lib/document-io.ts 不 import @blocknote
// - 主题随 useThemeMode()（html.dark = 全站主题唯一事实源），深浅两态各看一次像素
import { useEffect, useMemo } from "react";
import type { PartialBlock } from "@blocknote/core";
import { zh } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/ariakit";
import { isBlockArray } from "@whispering233/ai-editor-shared";
import { useThemeMode } from "../../hooks/use-theme-mode";
import { EditorToolbar } from "./editor-toolbar";
import "@blocknote/ariakit/style.css";
import "./blocknote.css";

/**
 * 块数组 JSON 字符串 → 初始块：空串 / 解析失败 / 非块数组 → `undefined`（交给 BlockNote 的默认空段落）。
 *
 * **绝不能返回空数组 `[]`**（真事故：新章「写正文」整页被错误边界接管）：
 * `@blocknote/core` 建文档的写法是 `t.initialContent || [{ type: "paragraph", id: generateID() }]`，
 * 随后立即 `if (!Array.isArray(e) || e.length === 0) throw` —— `[]` 是 truthy，默认段落不会兜底，
 * 紧接着就命中 length === 0 抛错，外层 catch 再包成
 * `Error creating document from blocks passed as \`initialContent\``（已对已装包 0.54.2 源码核实）。
 * 空缺内容（服务端「从未写过」= `""`，或合法但为空的 `"[]"`）必须传 `undefined`。
 */
export function parseBlockContent(content: string): PartialBlock[] | undefined {
  if (content === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(content);
    return isBlockArray(parsed) && parsed.length > 0 ? (parsed as PartialBlock[]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 编辑器能力出口（卡 12.6 导入导出用）：markdown ↔ 块的互转只有持有实例的一侧能做
 * （`blocksToMarkdownLossy` / `tryParseMarkdownToBlocks` 都要 pmSchema + 实例），
 * 借此把能力递给页面，让 lib/document-io 保持纯函数（不 import @blocknote）。
 */
export interface DocumentEditorApi {
 /** 块数组 JSON → markdown（库的有损导出；content 空 / 坏数据 → ""） */
  toMarkdown(content: string): string;
 /** markdown → { content: 块数组 JSON, roundTripped: 解析后回写的 md }（导入先解析，回写供往返比对） */
  parseMarkdown(markdown: string): { content: string; roundTripped: string };
}

export interface DocumentEditorProps {
 /** 初始内容（块数组 JSON 字符串；空串 / 空数组 = 空文档）——仅挂载时消费，外部改写请换 key 重挂 */
  initialContent: string;
 /** 内容变化：把 editor.document 序列化为块数组 JSON 字符串交给调用方（保存/自动保存） */
  onChange: (content: string) => void;
 /** 实例能力出口：挂载（含换 key 重挂）后回调一次，页面存进 ref/state 供导入导出使用 */
  onReady?: (api: DocumentEditorApi) => void;
}

export function DocumentEditor({ initialContent, onChange, onReady }: DocumentEditorProps) {
  const theme = useThemeMode();
  // UI 语言 = 中文（项目语言恒 zh，页头「语言: zh」）：不传 dictionary 时 placeholder / 斜杠菜单 /
  // 工具栏走 @blocknote/core 的英文默认。边界：本仓无 i18n 切换，将来引入多语言时这里改成按项目语言选择。
  const editor = useCreateBlockNote({
    initialContent: parseBlockContent(initialContent),
    dictionary: zh,
  });

  // 能力出口（随实例变化：换 key 重挂 = 新实例）。onReady 只在 effect 里回调，避免渲染期改父组件状态
  const api = useMemo<DocumentEditorApi>(
    () => ({
      toMarkdown: (content) => {
        const blocks = parseBlockContent(content);
        return blocks === undefined ? "" : editor.blocksToMarkdownLossy(blocks);
      },
      parseMarkdown: (markdown) => {
        const blocks = editor.tryParseMarkdownToBlocks(markdown);
        return { content: JSON.stringify(blocks), roundTripped: editor.blocksToMarkdownLossy(blocks) };
      },
    }),
    [editor],
  );
  useEffect(() => {
    onReady?.(api);
  }, [api, onReady]);

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      onChange={(next) => onChange(JSON.stringify(next.document))}
    >
      <EditorToolbar />
    </BlockNoteView>
  );
}
