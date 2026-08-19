// 查询类工具：参考资料（决策 36，批次九）
// search_references——AI 不知道书里有哪些参考资料时先搜索（标题+tags 关键词命中）再按需取全文
//
// 契约来源：doc/api/tools.md「参考资料查询」；决策 6 分层策略（不主动注入聚焦层，
// 靠工具按需拉取保护 token 预算）。全文取详情走 get_entity('reference', id) 的 reference 分支。
//
// 实现：复用 db listEntities（type='reference' + q 名称软删过滤 + filters.tags AND 匹配
// + 摘要提取）——db toSummary 已对 reference 做 type + content 摘要截断 120 字 + tags 前 3，
// 列表/搜索不会把全文长文本带回（防决策 15 token 膨胀）。
// search 的 type 参数指「参考资料分类」（data.type 枚举），非实体类型——listEntities 的
// filters 不支持 data.type 过滤（仅 tags/status），故在结果层做 JS 过滤（total 同步修正）。

import { listEntities } from "@whispering233/ai-editor-db";
import type { EntityListResult } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import type { SearchReferencesArgs } from "@whispering233/ai-editor-shared";

/** 参考资料搜索（tools.md search_references(query, type?, tags?) → 摘要列表） */
export function runSearchReferences(ctx: ToolContext, args: SearchReferencesArgs): EntityListResult {
  const result = listEntities(ctx.db, {
    type: "reference",
    q: args.query,
    filters: args.tags !== undefined ? { tags: args.tags } : undefined,
    limit: 200,
  });
  // type 分类过滤（data.type 枚举经 db toSummary 暴露为 summary.type）：结果层 JS 过滤——total 同步
  if (args.type !== undefined) {
    const filtered = result.items.filter((row) => row.summary?.type === args.type);
    return { items: filtered, total: filtered.length };
  }
  return result;
}
