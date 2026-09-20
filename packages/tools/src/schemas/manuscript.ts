// 工具参数 schema：章正文域（get_chapter_text）
//
// 口径见 docs/api/tool-calling.md「正文只读查询（2026-09）」：AI 按需分页拉取章正文的
// 轻量 md 投影（document_records.content_text）；**工具面不存在任何正文/文档写工具**。

import { Type, type Static } from "@earendil-works/pi-ai";

/**
 * get_chapter_text 入参：node_id（**必须是章节点**）+ offset（起始字符下标，缺省 0）
 * + max_chars（本次最多返回字符数，缺省与上限见 `query/manuscript.ts` 的
 *   `DEFAULT_CHAPTER_TEXT_CHARS` / `MAX_CHAPTER_TEXT_CHARS`——实现层 clamp）。
 */
export const getChapterTextArgsSchema = Type.Object(
  {
    node_id: Type.String(),
    offset: Type.Optional(Type.Integer({ minimum: 0 })),
    max_chars: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export type GetChapterTextArgs = Static<typeof getChapterTextArgsSchema>;
