// 查询类工具：实体侧实现（S6.3）
// get_entity / search_entities / get_entity_summary
// 契约来源：doc/api/tools.md「实体查询」「聚合分析」；doc/api/endpoints.md 实体端点；
//   决策 12 修订（查询类工具默认过滤软删对象）。
//
// db 层能力确认与分工（S6.3 修复轮：数据访问一律走 db 查询层，工具层无原生 SQL）：
// - get_entity：db getEntity 已过滤软删（决策 12）——工具层直接复用；
//   type 一致性校验（id 前缀体系全局唯一，type 传错 = 参数错误，返回 null 让 LLM 自纠）
// - search_entities：db listEntities 已扩展 filters（tags/status data 字段 JS 过滤，
//   S6.3 下沉）+ 软删过滤 + 摘要提取单一化（db toSummary）——工具层参数映射透传
// - get_entity_summary：db getEntitySummaryStats（S6.3 下沉：总数 + 类型专属分布，
//   稀疏字段知识归拢 db 单一位置）——工具层透传

import { getEntity as dbGetEntity, getEntitySummaryStats, listEntities } from "@whispering233/ai-editor-db";
import { mapRowToEntity } from "@whispering233/ai-editor-shared";
import type { Entity } from "@whispering233/ai-editor-shared";
import type { EntityListResult, EntitySummaryStats } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import type { GetEntityArgs, GetEntitySummaryArgs, SearchEntitiesArgs } from "@whispering233/ai-editor-shared";

// ============ get_entity ============

/**
 * 实体详情（tools.md get_entity(type, id) → 实体详情，含 data JSON 解析后的字段）。
 * - db 层 getEntity 默认过滤软删（决策 12 修订：回收站对象不可见）
 * - type 与行内实际类型不一致 → null（参数错误，id 前缀体系下正常调用不会出现；
 *   LLM 传错类型时得到「不存在」而非脏数据）
 * - 不存在/已软删 → null（查询无结果 ≠ 失败，LLM 据 null 自纠或向用户确认）
 */
export function runGetEntity(ctx: ToolContext, args: GetEntityArgs): Entity | null {
  const row = dbGetEntity(ctx.db, args.id);
  if (row === null || row.type !== args.type) return null;
  return mapRowToEntity(row);
}

// ============ search_entities ============

/** search_entities 结果：匹配实体摘要列表 + 过滤后总数（db listEntities 同构） */
export type SearchEntitiesResult = EntityListResult;

/**
 * 实体搜索（tools.md search_entities(type, query, filters?) → 匹配实体列表）。
 * 透传 db listEntities：type + name LIKE 模糊匹配 + **软删过滤**（决策 12 修订）
 * + filters（tags AND / status 精确匹配，data 字段 JS 过滤）+ 摘要提取（db 单一实现）。
 * limit 传 200（db clamp 上限）：搜索结果尽量全（token 截断由上层按决策 15 处理）。
 */
export function runSearchEntities(ctx: ToolContext, args: SearchEntitiesArgs): SearchEntitiesResult {
  return listEntities(ctx.db, {
    type: args.type,
    q: args.query,
    filters: args.filters,
    limit: 200,
  });
}

// ============ get_entity_summary ============

/**
 * 实体聚合统计（tools.md get_entity_summary(type) → 总数、角色分布、能力分布等）。
 * 透传 db getEntitySummaryStats：仅统计非软删实体（决策 12 修订）；分布字段按类型
 * 稀疏出现（character→byRole/byStatus/topAbilities、setting→byCategory、
 * location→byType、hook→byStatus/byPayoffTiming），缺字段不报错。
 */
export function runGetEntitySummary(ctx: ToolContext, args: GetEntitySummaryArgs): EntitySummaryStats {
  return getEntitySummaryStats(ctx.db, args.type);
}
