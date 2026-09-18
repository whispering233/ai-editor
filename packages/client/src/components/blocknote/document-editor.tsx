// 块编辑器封装（卡 12.5）：章正文与参考资料正文共用（12.8 复用同一组件）。
// - 编辑器实例 = @blocknote/react 的 useCreateBlockNote —— **初始内容只在挂载时消费一次**
//   （BlockNote 非受控：外部改写内容必须换 key 重挂，见 pages/Manuscript.tsx 的 editorEpoch）
// - 视图 = @blocknote/ariakit 变体（DESIGN.md §Colors「块编辑器」登记的第二套表皮；样式随该包引入）
// - 改色唯一入口 = 同目录 blocknote.css（调用点不得写 --bn-* 覆盖或内联色值）
// - 主题随 useThemeMode()（html.dark = 全站主题唯一事实源），深浅两态各看一次像素
import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/ariakit";
import { isBlockArray } from "@whispering233/ai-editor-shared";
import { useThemeMode } from "../../hooks/use-theme-mode";
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

export interface DocumentEditorProps {
 /** 初始内容（块数组 JSON 字符串；空串 / 空数组 = 空文档）——仅挂载时消费，外部改写请换 key 重挂 */
  initialContent: string;
 /** 内容变化：把 editor.document 序列化为块数组 JSON 字符串交给调用方（保存/自动保存） */
  onChange: (content: string) => void;
}

export function DocumentEditor({ initialContent, onChange }: DocumentEditorProps) {
  const theme = useThemeMode();
  const editor = useCreateBlockNote({ initialContent: parseBlockContent(initialContent) });

  return (
    <BlockNoteView
      editor={editor}
      theme={theme}
      onChange={(next) => onChange(JSON.stringify(next.document))}
    />
  );
}
