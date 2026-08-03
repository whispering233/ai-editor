// 分析类工具：suggest_connections（潜在关系发现，S6.4）
// 契约来源：doc/api/tools.md「关系发现」→ { suggestions: [{ target_id, relation_type, reason }] }
// 语义：为指定实体发现与同类型其他实体的潜在关联（启发式信号）：
// - S1 共享场景（强信号）：两角色共同 appears_in 于同一大纲节点（同场戏出现过）
// - S2 共同邻居（次信号）：两实体在实体关系图中共享直接关联实体（「朋友的朋友」）
// 已存在直接关系的候选跳过；建议按信号强度降序取 top 10；relation_type 建议
// ally（同场戏相识）/ ally（经中间人相识）。
// 数据访问：db 查询层（getEntity/listEntities/listRelations）+ 纯函数图分析，无原生 SQL。
// signal：全量候选 × 信号计算为长任务候选，循环中检查（决策 16 ③）。

import { getEntity, listEntities, listRelations } from "@ai-editor/db";
import type { ToolContext } from "../context.js";
import { buildEntityGraph, intersectSets, isEntityType, throwIfAborted } from "./utils.js";
import type { SuggestConnectionsArgs } from "@ai-editor/shared";

/** 潜在关联建议（tools.md suggest_connections 返回项） */
export interface ConnectionSuggestion {
  target_id: string;
  /** 建议的关系类型（预定义枚举；用户确认后可建立） */
  relation_type: string;
  reason: string;
}

/** 建议条数上限（防 token 爆炸，决策 15） */
const SUGGESTION_LIMIT = 10;

/** 场景标题映射（outline_node 端点的 targetName 由 listRelations 联表填充） */
function sceneTitleOf(relations: ReadonlyArray<{ targetId: string; targetName?: string }>, sceneId: string): string {
  return relations.find((r) => r.targetId === sceneId)?.targetName ?? sceneId;
}

/**
 * 潜在关系发现（tools.md suggest_connections(entity_id)）。
 * 实体不存在/已软删 → null（查询无结果）；同类型无其他实体 → 空建议。
 * 信号优先级：共享场景（S1）> 共同邻居（S2），每候选最多一条建议（取最强信号）；
 * 软删对象不可见（查询层默认过滤，决策 12）；已有直接关系的候选跳过。
 */
export function runSuggestConnections(ctx: ToolContext, args: SuggestConnectionsArgs, signal?: AbortSignal): { suggestions: ConnectionSuggestion[] } | null {
  const entity = getEntity(ctx.db, args.entity_id);
  if (entity === null) return null;
  throwIfAborted(signal);

  // 1. 同类型候选（非软删，排除自身）；全量实体名映射（S2 共同邻居可能跨类型——
  //    邻居名从全量映射取，避免退化为 id）
  const candidates = listEntities(ctx.db, { type: entity.type, limit: 200 }).items.filter((c) => c.id !== entity.id);
  const allEntities = listEntities(ctx.db, { limit: 200 }).items;
  const entityName = new Map(allEntities.map((e) => [e.id, e.name]));
  if (candidates.length === 0) return { suggestions: [] };

  // 2. 全量可见关系：实体图（共同邻居）+ appears_in 分组（共享场景）+ 直接关联集合
  const relations = listRelations(ctx.db, {}, 1, ctx.outlineDir).relations;
  throwIfAborted(signal);
  const graph = buildEntityGraph(relations);
  const appearsIn = new Map<string, string[]>(); // 实体 id → 出现节点集合
  const directlyLinked = new Set<string>(); // 与目标实体已有实体-实体直接关系的候选
  for (const r of relations) {
    if (r.relationType === "appears_in" && isEntityType(r.sourceType) && r.targetType === "outline_node") {
      const list = appearsIn.get(r.sourceId) ?? [];
      list.push(r.targetId);
      appearsIn.set(r.sourceId, list);
    }
    if (isEntityType(r.sourceType) && isEntityType(r.targetType)) {
      if (r.sourceId === entity.id) directlyLinked.add(r.targetId);
      if (r.targetId === entity.id) directlyLinked.add(r.sourceId);
    }
  }

  // 3. 逐候选信号计算（S1 共享场景 > S2 共同邻居）
  interface Scored {
    targetId: string;
    score: number;
    relationType: string;
    reason: string;
  }
  const scored: Scored[] = [];
  const myScenes = new Set(appearsIn.get(entity.id) ?? []);
  const myNeighbors = new Set(graph.get(entity.id) ?? []);
  for (const c of candidates) {
    throwIfAborted(signal);
    if (directlyLinked.has(c.id)) continue; // 已有直接关系，无需建议
    // S1：共享场景（同场戏出现过）
    const sharedScenes = intersectSets(myScenes, new Set(appearsIn.get(c.id) ?? []));
    if (sharedScenes.length > 0) {
      const sceneName = sceneTitleOf(relations, sharedScenes[0]);
      scored.push({
        targetId: c.id,
        score: 100 + sharedScenes.length, // 场景信号优先于邻居信号
        relationType: "ally",
        reason: `与「${c.name}」共同出现于 ${sharedScenes.length} 个场景（如「${sceneName}」），可建立相识/盟友关系`,
      });
      continue;
    }
    // S2：共同邻居（「朋友的朋友」）
    const sharedNeighbors = intersectSets(myNeighbors, new Set(graph.get(c.id) ?? []));
    if (sharedNeighbors.length > 0) {
      const neighborName = entityName.get(sharedNeighbors[0]) ?? sharedNeighbors[0]; // 跨类型邻居名（全量映射）
      scored.push({
        targetId: c.id,
        score: sharedNeighbors.length,
        relationType: "ally",
        reason: `与「${c.name}」有 ${sharedNeighbors.length} 个共同关联实体（如「${neighborName}」），可经中间人建立关系`,
      });
    }
  }

  // 4. 信号强度降序 → top 10（并列按 target_id 稳定排序）
  scored.sort((a, b) => (b.score === a.score ? a.targetId.localeCompare(b.targetId) : b.score - a.score));
  return {
    suggestions: scored.slice(0, SUGGESTION_LIMIT).map((s) => ({ target_id: s.targetId, relation_type: s.relationType, reason: s.reason })),
  };
}
