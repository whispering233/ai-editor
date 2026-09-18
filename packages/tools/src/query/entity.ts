// 查询类工具：实体侧实现（S6.3）
// get_entity / search_entities / get_entity_summary
//
// db 层能力确认与分工（S6.3 修复轮：数据访问一律走 db 查询层，工具层无原生 SQL）：
// - get_entity：db getEntity 已过滤软删——工具层直接复用；
// type 一致性校验（id 前缀体系全局唯一，type 传错 = 参数错误，返回 null 让 LLM 自纠）
// - search_entities：db listEntities 已扩展 filters（tags/status data 字段 JS 过滤，
// S6.3 下沉）+ 软删过滤 + 摘要提取单一化（db toSummary）——工具层参数映射透传
// - get_entity_summary：db getEntitySummaryStats（S6.3 下沉：总数 + 类型专属分布，
// 稀疏字段知识归拢 db 单一位置）——工具层透传

import { getDocument, getEntity as dbGetEntity, getEntitySummaryStats, listEntities } from "@whispering233/ai-editor-db";
import { mapRowToEntity } from "@whispering233/ai-editor-shared";
import type { Entity } from "@whispering233/ai-editor-shared";
import type { EntityListResult, EntitySummaryStats } from "@whispering233/ai-editor-db";
import type { ToolContext } from "../context.js";
import type { GetEntityArgs, GetEntitySummaryArgs, SearchEntitiesArgs } from "../schemas/index.js";

// ============ get_entity ============

/**
 * get_entity 结果：实体详情 + `content`（**仅 reference 填充**）。
 * reference 的正文真相在 `document_records`，此处只回 `content_text` 轻量 md 投影——
 * 块 JSON 原文归编辑器，不进模型上下文（卡 12.9，docs/api/30-api-entity.md「reference 特例」）。
 */
export interface GetEntityResult extends Entity {
  content?: string;
}

/**
 * 实体详情（get_entity(type, id) → 实体详情，含 data JSON 解析后的字段）。
 * - db 层 getEntity 默认过滤软删（回收站对象不可见）
 * - type 与行内实际类型不一致 → null（参数错误，id 前缀体系下正常调用不会出现；
 * LLM 传错类型时得到「不存在」而非脏数据）
 * - 不存在/已软删 → null（查询无结果 ≠ 失败，LLM 据 null 自纠或向用户确认）
 * - reference：附全文投影 `content`（未写过正文 → 空串；列表摘要的截断只在
 * search_references，详情取全文）
 */
export function runGetEntity(ctx: ToolContext, args: GetEntityArgs): GetEntityResult | null {
  const row = dbGetEntity(ctx.db, args.id);
  if (row === null || row.type !== args.type) return null;
  const entity = mapRowToEntity(row);
  if (row.type !== "reference") return entity;
  return { ...entity, content: getDocument(ctx.db, "reference", row.id)?.content_text ?? "" };
}

// ============ search_entities ============

/** search_entities 结果：匹配实体摘要列表 + 过滤后总数（db listEntities 同构） */
export type SearchEntitiesResult = EntityListResult;

/**
 * 实体搜索（search_entities(type, query, filters?) → 匹配实体列表）。
 * 透传 db listEntities：type + name LIKE 模糊匹配 + **软删过滤**
 * + filters（tags AND / status 精确匹配，data 字段 JS 过滤）+ 摘要提取（db 单一实现）。
 * limit 取 db `listEntities` 的 clamp 上限（clamp 数值单源在 db）：搜索结果尽量全（token 截断由上层按需处理）。
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
 * 实体聚合统计（get_entity_summary(type) → 总数、角色分布、能力分布等）。
 * 透传 db getEntitySummaryStats：仅统计非软删实体；分布字段按类型
 * 稀疏出现（character→byRole/topAbilities（**能力面板顶层分组名**；status 分布已随字段移除）、
 * setting→byTags（分类由 tags 承接）、location→byType、hook→byStatus/byPayoffTiming），缺字段不报错。
 */
export function runGetEntitySummary(ctx: ToolContext, args: GetEntitySummaryArgs): EntitySummaryStats {
  return getEntitySummaryStats(ctx.db, args.type);
}
