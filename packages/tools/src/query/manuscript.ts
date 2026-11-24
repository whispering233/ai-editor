// 查询类工具：章正文只读（卡 12.9）
// get_chapter_text——AI 需要看「作者到底写了什么」时按需拉取（分析节奏、核对与设定的冲突、
// 评价具体段落）。
//
// 口径（docs/api/tool-calling.md「正文只读查询（2026-09）」、
// `docs/design/10-data-model.md` §13）：
// - text = `document_records.content_text`（**服务端派生的轻量 md 投影**）——块 JSON 原文
//   只服务编辑器，绝不进模型上下文
// - 分页：offset / 长度均为 **JS 字符串下标**（与 `charCount` 同源口径）；截断时 text 末尾
//   附续读提示（「截断必须显式告知」，docs/design/20-context.md §2 不变式）
// - 节点必须存在、未软删且 `type === "chapter"`（复用提案层 requireChapterNode——与
//   propose_add_delta 的章级口径同源，非章抛错）；未写过正文 → char_count=0、text=""（不报错）
// - **只读**：工具面不存在任何正文/文档写工具（结构性保证，非提示词约束）

import { deriveChapterOrder, getChapterNumber, getDocument, getDocumentTexts, readOutlineFile, searchChapterIds } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import { requireChapterNode } from "../proposal/types.js";
import type { GetChapterTextArgs, SearchManuscriptArgs } from "../schemas/index.js";

/**
 * 缺省单次返回字符数（≈ 一段中等篇幅；长文分段读完，不炸上下文）。
 * **文本分页预算单源**：章正文（get_chapter_text）与练习**四只读工具**（get_practice_sample /
 * get_practice_draft / get_free_draft / get_style_notes）共用这一对常量（语义提升，见 docs/api/tool-calling.md）。
 */
export const DEFAULT_TEXT_PAGE_CHARS = 6000;

/**
 * 单次返回字符数上限（clamp 上限）——必须连 JSON 信封与续读提示一起压进单条工具结果预算：
 * agent 侧 `TOOL_RESULT_MAX_TOKENS`（packages/agent/src/runtime/tool-result.ts，
 * 单条结果超限即截断 + 显式告知，docs/design/20-context.md §2）；`estimateTokens` 对非 ASCII
 * 一律按 1 字 = 1 token 计（CJK ≈1 token/字，故意高估）。
 *
 * 上限页 + 续读提示 + JSON 信封必须留在预算内并留白（≥10%，给标题/章号更长与提示文案变动）；
 * 一旦溢出，外层截断会连「可用 offset=N 继续读取」与 `truncated` 一起切掉，「截断必须显式告知」即失效。
 *
 * 改这个值前先按同一条实测路径（工具 → stringifyToolResult → truncateToolResultText）重量一遍；
 * 练习工具的同一对常量实测另见 packages/tools/src/query/practice.ts。
 */
export const MAX_TEXT_PAGE_CHARS = 7000;

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
    MAX_TEXT_PAGE_CHARS,
    Math.max(1, Math.trunc(args.max_chars ?? DEFAULT_TEXT_PAGE_CHARS)),
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

// ============ search_manuscript ============

/**
 * 检索片段窗宽：命中位置**前后各**取这么多字（snippet 长度 ≤ 两倍窗宽 + query 长度 + 两个省略号）。
 * **单源**：工具描述插值同一个常量（模型看到的数值与实际返回同源），回归见 `index.test.ts`。
 */
export const MANUSCRIPT_SNIPPET_WINDOW_CHARS = 40;

/**
 * 单页命中章数上限（search_manuscript 一页最多回多少章）。
 * 上限页 = `MAX_MANUSCRIPT_SEARCH_HITS` ×（片段 + JSON 信封）——必须远低于 agent 侧单条结果上限
 * `TOOL_RESULT_MAX_TOKENS`（超限即被外层截断，`truncated` / `next_offset` 会一并被切掉）。
 */
export const MAX_MANUSCRIPT_SEARCH_HITS = 20;

/** search_manuscript 命中项：章 + 阅读序章号 + 标题 + 命中片段 */
export interface ManuscriptSearchHit {
  chapterId: string;
  chapterNumber: number;
  title: string;
  /** 命中位置前后各取 `MANUSCRIPT_SNIPPET_WINDOW_CHARS` 字；首尾被截的一侧补「…」（命中词必在其中） */
  snippet: string;
}

/** search_manuscript 结果：命中章列表 + 命中总数；未取完时附续页信息（与 search_entities 同口径） */
export interface SearchManuscriptResult {
  items: ManuscriptSearchHit[];
  /** 命中的**可见**章总数（与 offset 无关） */
  total: number;
  /** true = 后面还有未返回的命中（items 不完整） */
  truncated?: boolean;
  /** 下一页的 offset（仅 truncated = true 时出现） */
  next_offset?: number;
}

/** 可见章（未软删，含未软删的卷下的章）按**阅读序**排序——章号取 `deriveChapterOrder`（阅读序单源），
 * 标题与可见性取自同一棵大纲树（软删卷下的章整批不可见，防手改 outline.json 的脏数据）。 */
function visibleChaptersInReadingOrder(dir: string): Array<{ id: string; title: string; chapterNumber: number }> {
  const chapterNumbers = new Map(deriveChapterOrder(dir).map((entry) => [entry.chapterId, entry.chapterNumber]));
  const chapters = readOutlineFile(dir).children.flatMap((child) =>
    child.type === "chapter" ? [child] : child.deleted === true ? [] : (child.children ?? []),
  );
  const out: Array<{ id: string; title: string; chapterNumber: number }> = [];
  for (const chapter of chapters) {
    if (chapter.deleted === true) continue;
    const chapterNumber = chapterNumbers.get(chapter.id);
    if (chapterNumber === undefined) continue; // 脏数据防御：章不在章序表里 → 无阅读序位置
    out.push({ id: chapter.id, title: chapter.title, chapterNumber });
  }
  return out;
}

/**
 * 命中片段：取**第一处**命中，前后各 `MANUSCRIPT_SNIPPET_WINDOW_CHARS` 字，被截的一侧补「…」。
 * 小写后比对（SQLite LIKE 对 ASCII 大小写不敏感，indexOf 需同口径）；比对不到（Unicode 折叠差异）
 * 退回章首——片段仍可读，不因大小写口径差异崩。
 */
function makeSnippet(text: string, query: string): string {
  const at = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase()));
  const start = Math.max(0, at - MANUSCRIPT_SNIPPET_WINDOW_CHARS);
  const end = Math.min(text.length, at + query.length + MANUSCRIPT_SNIPPET_WINDOW_CHARS);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * 正文检索（search_manuscript(query, offset?) → 命中章列表，按阅读序）。
 *
 * - 检索 = `document_records.content_text LIKE %query%`（`owner_kind='chapter'`；**不上 FTS5**——
 *   157 万字全表扫实测 5–9ms，检索量级不配一个索引结构 / 迁移）
 * - 排序 = 阅读序（卷序 → 卷内章序，复用 `deriveChapterOrder`）；软删章不出现
 * - 分页 = offset + `MAX_MANUSCRIPT_SEARCH_HITS` 一页；未取完 → truncated + next_offset（同 search_entities）
 * - 正文按页取（`getDocumentTexts`）：命中全书时也不必把 157 万字拉进内存求片段
 *
 * @throws query 空串 / 纯空白（否则退化为「列出全部已写章」）；offset 非非负整数
 */
export function runSearchManuscript(ctx: ToolContext, args: SearchManuscriptArgs): SearchManuscriptResult {
  const query = args.query.trim();
  if (query === "") {
    throw new Error("query 不能为空（正文检索必须给关键词）");
  }
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`offset 必须为非负整数: ${String(args.offset)}`);
  }

  const matched = new Set(searchChapterIds(ctx.db, query));
  const hits = visibleChaptersInReadingOrder(ctx.outlineDir).filter((chapter) => matched.has(chapter.id));
  const page = hits.slice(offset, offset + MAX_MANUSCRIPT_SEARCH_HITS);
  const texts = getDocumentTexts(ctx.db, "chapter", page.map((chapter) => chapter.id));
  const items = page.map((chapter) => ({
    chapterId: chapter.id,
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    snippet: makeSnippet(texts.get(chapter.id) ?? "", query),
  }));
  const nextOffset = offset + items.length;
  return nextOffset < hits.length
    ? { items, total: hits.length, truncated: true, next_offset: nextOffset }
    : { items, total: hits.length };
}
