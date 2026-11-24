// 查询类工具：参考资料
// search_references——AI 不知道书里有哪些参考资料时先搜索（标题+tags 关键词命中）再按需取全文
//
// 靠工具按需拉取保护 token 预算）。全文取详情走 get_entity('reference', id) 的 reference 分支。
//
// 实现：复用 db listEntities（type='reference' + q 名称软删过滤 + filters.tags AND 匹配
// + 摘要提取）——db toSummary 已对 reference 做 type + content 投影摘要截断 + tags 条数截断
// （两者长度/条数上限的数值单源在 db `toSummary`），
// 列表/搜索不会把全文长文本带回（防 token 膨胀）。
// search 的 type 参数指「参考资料分类」（data.type 枚举），非实体类型——listEntities 的
// filters 不支持 data.type 过滤（仅 tags/status），故在结果层做 JS 过滤（total 同步修正）。
//
// `body: true`（2026-11）追加**正文命中面**：`document_records.content_text LIKE %query%`
// （`owner_kind='reference'`；**不上 FTS5**——与 search_manuscript 同取舍，参考资料总量小得多）。
// 正文命中的条目带 `snippet`（命中位置前后各 `REFERENCE_SNIPPET_WINDOW_CHARS` 字），
// 只按名称/tags 命中的条目不带。

import { getDocumentTexts, listEntities, searchReferenceIds } from "@whispering233/ai-editor-db";
import { MAX_ENTITY_LIST_LIMIT } from "@whispering233/ai-editor-shared";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import type { SearchReferencesArgs } from "../schemas/index.js";

/**
 * 检索片段窗宽：命中位置**前后各**取这么多字（snippet 长度 ≤ 两倍窗宽 + query 长度 + 两个省略号）。
 * 与 `search_manuscript` 的 `MANUSCRIPT_SNIPPET_WINDOW_CHARS` 同值但各自独立——两处检索的
 * 命中语境不同（章正文 vs 参考资料摘抄），调一处不应牵动另一处。
 */
export const REFERENCE_SNIPPET_WINDOW_CHARS = 40;

/** 参考资料搜索命中项：摘要（同 EntitySummary）+ 正文命中片段（仅正文命中时出现） */
export interface ReferenceSearchHit extends EntitySummary {
  /** 命中位置前后各取 `REFERENCE_SNIPPET_WINDOW_CHARS` 字；首尾被截的一侧补「…」 */
  snippet?: string;
}

/** search_references 结果（摘要列表；`total` = 命中总数） */
export interface SearchReferencesResult {
  items: ReferenceSearchHit[];
  total: number;
}

/**
 * 命中片段：取**第一处**命中，前后各 `REFERENCE_SNIPPET_WINDOW_CHARS` 字，被截的一侧补「…」。
 * 小写后比对（SQLite LIKE 对 ASCII 大小写不敏感，indexOf 需同口径）；比对不到（Unicode 折叠差异 /
 * 空 query）退回正文开头——片段仍可读，不因大小写口径差异崩。
 */
function makeSnippet(text: string, query: string): string {
  const at = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase()));
  const start = Math.max(0, at - REFERENCE_SNIPPET_WINDOW_CHARS);
  const end = Math.min(text.length, at + query.length + REFERENCE_SNIPPET_WINDOW_CHARS);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * 参考资料搜索（search_references(query, type?, tags?, body?) → 摘要列表）。
 *
 * - 欠省 body（false）= 只按名称/tags 命中：逐字保留旧返回值（items 顺序与 total 都不动）
 * - `body: true` = 命中面再加正文（`searchReferenceIds`），命中的条目带 `snippet`；
 *   正文命中但名称未命中的条目追加在名称命中之后（顺序仍取自 listEntities 的同一排序）
 * - tags / type 过滤对正文命中同样生效（tags 在 SQL 层、type 在结果层，与名称命中同一口径）
 */
export function runSearchReferences(ctx: ToolContext, args: SearchReferencesArgs): SearchReferencesResult {
  const filters = args.tags !== undefined ? { tags: args.tags } : undefined;
  const named = listEntities(ctx.db, { type: "reference", q: args.query, filters, limit: MAX_ENTITY_LIST_LIMIT });
  const applyType = (items: ReferenceSearchHit[]): ReferenceSearchHit[] =>
    args.type === undefined ? items : items.filter((row) => row.summary?.type === args.type);

  if (args.body !== true) {
    const filtered = applyType(named.items);
    // type 过滤在结果层做（total 同步修正）；不过滤时 total 沿用 listEntities 的计数
    return { items: filtered, total: args.type === undefined ? named.total : filtered.length };
  }

  const bodyHits = new Set(searchReferenceIds(ctx.db, args.query));
  const items: ReferenceSearchHit[] = [...named.items];
  if (bodyHits.size > 0) {
    const namedIds = new Set(named.items.map((item) => item.id));
    // 正文命中但名称未命中的参考资料：一次全量列表取摘要（不逐条 getEntity），再与正文命中求交
    for (const item of listEntities(ctx.db, { type: "reference", filters, limit: MAX_ENTITY_LIST_LIMIT }).items) {
      if (bodyHits.has(item.id) && !namedIds.has(item.id)) items.push(item);
    }
    const texts = getDocumentTexts(ctx.db, "reference", [...bodyHits]);
    for (const item of items) {
      if (!bodyHits.has(item.id)) continue;
      item.snippet = makeSnippet(texts.get(item.id) ?? "", args.query);
    }
  }
  const filtered = applyType(items);
  return { items: filtered, total: filtered.length };
}