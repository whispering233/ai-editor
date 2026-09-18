// 查询类工具：章正文只读（卡 12.9）
// get_chapter_text——AI 需要看「作者到底写了什么」时按需拉取（分析节奏、核对与设定的冲突、
// 评价具体段落）。
//
// 口径（docs/api/tool-calling.md「正文只读查询（2026-10）」、
// `docs/design/10-data-model.md` §13）：
// - text = `document_records.content_text`（**服务端派生的轻量 md 投影**）——块 JSON 原文
//   只服务编辑器，绝不进模型上下文
// - 分页：offset / 长度均为 **JS 字符串下标**（与 `charCount` 同源口径）；截断时 text 末尾
//   附续读提示（「截断必须显式告知」，docs/design/20-context.md §2 不变式）
// - 节点必须存在、未软删且 `type === "chapter"`（复用提案层 requireChapterNode——与
//   propose_add_delta 的章级口径同源，非章抛错）；未写过正文 → char_count=0、text=""（不报错）
// - **只读**：工具面不存在任何正文/文档写工具（结构性保证，非提示词约束）

import { getChapterNumber, getDocument } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import { requireChapterNode } from "../proposal/types.js";
import type { GetChapterTextArgs } from "../schemas/index.js";

/**
 * 缺省单次返回字符数（≈ 一段中等篇幅；长章分段读完，不炸上下文）。
 * 实测（真实截断函数走一遍工具结果，纯 CJK）：缺省页 + 续读提示 = 6055 tokens，余量 24.3%。
 */
export const DEFAULT_CHAPTER_TEXT_CHARS = 6000;

/**
 * 单次返回字符数上限（clamp 上限）——必须连 JSON 信封与续读提示一起压进单条工具结果预算：
 * agent 侧 `TOOL_RESULT_MAX_TOKENS = 8000`（packages/agent/src/runtime/tool-result.ts，
 * 单条结果超限即截断 + 显式告知，docs/design/20-context.md §2）；`estimateTokens` 对非 ASCII
 * 一律按 1 字 = 1 token 计（CJK ≈1 token/字，故意高估）。
 *
 * **实测**（`truncateToolResultText(stringifyToolResult(工具结果))`，纯 CJK 章、正文 = 上限 + 1）：
 * 上限页 + 续读提示 = **7055 tokens**（信封开销 ≈55 tokens：JSON 键 + 提示文案），余量 945 tokens
 * = **11.8%**（≥10% 留白，给标题/章号更长与提示文案变动）。取 8000 字时同法实测 8055 tokens
 * > 8000 ⇒ 外层截断会连「可用 offset=N 继续读取」与 `truncated` 一起切掉，「截断必须显式告知」失效。
 *
 * 改这个值前先按同一条实测路径（工具 → stringifyToolResult → truncateToolResultText）重量一遍。
 */
export const MAX_CHAPTER_TEXT_CHARS = 7000;

/** get_chapter_text 结果（工具目录逐字对齐：docs/api/tool-calling.md「正文只读查询」） */
export interface ChapterTextResult {
  chapter_id: string;
  title: string;
  /** 全局章序号（跨卷连续，1 起）；无章序号（防御：章不在章序表）→ null */
  chapter_number: number | null;
  /** 该章正文全长（与章正文端点 charCount 同源口径），与 offset 无关 */
  char_count: number;
  offset: number;
  /** 本次实际返回的正文片段长度（不含截断提示文案） */
  returned_chars: number;
  text: string;
  truncated: boolean;
}

/**
 * 章正文分页读取（get_chapter_text(node_id, offset?, max_chars?)）。
 * @throws 节点不存在 / 已软删 / 非章（与 propose_add_delta 同口径）；
 *         offset 非非负整数（schema 之外防御——工具实现必须自校业务不变量）
 */
export function runGetChapterText(ctx: ToolContext, args: GetChapterTextArgs): ChapterTextResult {
  const node = requireChapterNode(ctx, args.node_id, "正文");
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`offset 必须为非负整数: ${String(args.offset)}`);
  }
  const maxChars = Math.min(
    MAX_CHAPTER_TEXT_CHARS,
    Math.max(1, Math.trunc(args.max_chars ?? DEFAULT_CHAPTER_TEXT_CHARS)),
  );

  const documentText = getDocument(ctx.db, "chapter", node.id)?.content_text ?? "";
  const slice = documentText.slice(offset, offset + maxChars);
  const truncated = offset + slice.length < documentText.length;
  const text = truncated
    ? `${slice}\n\n（已截断，可用 offset=${offset + slice.length} 继续读取）`
    : slice;

  return {
    chapter_id: node.id,
    title: node.title,
    chapter_number: getChapterNumber(ctx.outlineDir, node.id)?.chapterNumber ?? null,
    char_count: documentText.length,
    offset,
    returned_chars: slice.length,
    text,
    truncated,
  };
}
