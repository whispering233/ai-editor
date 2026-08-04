// 分析类工具：detect_conflicts（跨实体设定矛盾检测，S6.4）
// 契约来源：doc/api/tools.md「一致性分析」→ { conflicts: [{ entity_a, entity_b, field, description }] }
// 语义：从关系图自动发现设定矛盾（「A↔B 关系缺失导致的不一致」）：
// - R1 对称缺失（error）：ally/family 为对称关系，单向存在即矛盾（A ally B 但 B 未 ally A）
// - R2 互斥并存（warning）：同一对实体同时互为盟友与对手（ally + rival 并存）
// - R3 互杀（error）：A kills B 且 B kills A（双方互相击杀）
// 数据访问：db 查询层（listEntities 全量非软删实体 + listRelations 全量可见关系）+ 纯函数图分析，无原生 SQL。
// signal：全量关系遍历为长任务候选，循环中检查（决策 16 ③）。

import { listEntities, listRelations } from "@whispering233/ai-editor-db";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { isEntityType, throwIfAborted } from "./utils.js";
import type { DetectConflictsArgs } from "@whispering233/ai-editor-shared";

/** 单条跨实体矛盾（tools.md detect_conflicts 返回项；entity_a/entity_b 为实体 id） */
export interface ConflictIssue {
  entity_a: string;
  entity_b: string;
  field: string; // 矛盾所在字段（本实现固定 "relations"——关系图矛盾）
  description: string;
}

/** 对称关系类型（R1：单向存在即矛盾） */
const SYMMETRIC_RELATION_TYPES = ["ally", "family"] as const;

/** 互斥关系对（R2：同一对实体并存即矛盾） */
const MUTUALLY_EXCLUSIVE_PAIRS: ReadonlyArray<readonly [string, string]> = [["ally", "rival"]] as const;

/** 互杀关系类型（R3：双向同时存在即矛盾） */
const KILLS_RELATION_TYPE = "kills" as const;

/** 实体 id → 名字（矛盾描述可读化） */
function nameOf(entities: readonly EntitySummary[], id: string): string {
  return entities.find((e) => e.id === id)?.name ?? id;
}

/** 有向对聚合：pairKey → { a→b 关系类型集合, b→a 关系类型集合 } */
interface DirectedPair {
  a: string;
  b: string;
  ab: Set<string>; // a → b 方向的关系类型
  ba: Set<string>; // b → a 方向的关系类型
}

/**
 * 关系矛盾检测（tools.md detect_conflicts）。
 * types 限定参与检测的实体类型（缺省全部）；relation_filter 限定参与检测的关系类型
 * （缺省全部——规则按交集生效：R1 只查集合内的对称类型、R2 只查互斥对均在集合内、R3 只查集合含 kills）。
 * 软删对象不可见（listEntities/listRelations 默认过滤，决策 12）。
 * 返回按 (entity_a, entity_b) 稳定排序。
 */
export function runDetectConflicts(ctx: ToolContext, args: DetectConflictsArgs, signal?: AbortSignal): { conflicts: ConflictIssue[] } {
  const types = args.types;
  const relFilter = args.relation_filter !== undefined ? new Set<string>(args.relation_filter) : null;

  // 1. 全量非软删实体 + 全量可见关系（一次查询层调用各一）
  const entities = listEntities(ctx.db, { limit: 200 }).items;
  const relations = listRelations(ctx.db, {}, 1, ctx.outlineDir).relations;
  throwIfAborted(signal);

  // 2. 过滤：两端均为实体、类型在 types 内、关系类型在 relFilter 内（或缺省全量）
  const typeFilter = types !== undefined ? new Set(types) : null;
  const relevant = relations.filter(
    (r) =>
      isEntityType(r.sourceType) &&
      isEntityType(r.targetType) &&
      (typeFilter === null || typeFilter.has(r.sourceType as EntitySummary["type"])) &&
      (typeFilter === null || typeFilter.has(r.targetType as EntitySummary["type"])) &&
      (relFilter === null || relFilter.has(r.relationType)),
  );
  throwIfAborted(signal);

  // 3. 有向对聚合（无向 pairKey 归一，方向集合分别记录）
  const pairs = new Map<string, DirectedPair>();
  for (const r of relevant) {
    const [a, b] = r.sourceId < r.targetId ? [r.sourceId, r.targetId] : [r.targetId, r.sourceId];
    let pair = pairs.get(`${a}|${b}`);
    if (pair === undefined) {
      pair = { a, b, ab: new Set(), ba: new Set() };
      pairs.set(`${a}|${b}`, pair);
    }
    if (r.sourceId === pair.a) pair.ab.add(r.relationType);
    else pair.ba.add(r.relationType);
  }

  // 4. 规则判定（R1/R2/R3，逐对）
  const conflicts: ConflictIssue[] = [];
  for (const pair of pairs.values()) {
    throwIfAborted(signal);
    const nameA = nameOf(entities, pair.a);
    const nameB = nameOf(entities, pair.b);
    // R1：对称关系单向缺失
    for (const sym of SYMMETRIC_RELATION_TYPES) {
      if (relFilter !== null && !relFilter.has(sym)) continue;
      const hasAb = pair.ab.has(sym);
      const hasBa = pair.ba.has(sym);
      if (hasAb && !hasBa) {
        conflicts.push({
          entity_a: pair.a,
          entity_b: pair.b,
          field: "relations",
          description: `「${nameA}」对「${nameB}」存在单向 ${sym} 关系，反向缺失（对称关系应双向建立）`,
        });
      } else if (hasBa && !hasAb) {
        conflicts.push({
          entity_a: pair.b,
          entity_b: pair.a,
          field: "relations",
          description: `「${nameB}」对「${nameA}」存在单向 ${sym} 关系，反向缺失（对称关系应双向建立）`,
        });
      }
    }
    // R2：互斥关系并存（无向）
    for (const [x, y] of MUTUALLY_EXCLUSIVE_PAIRS) {
      if (relFilter !== null && (!relFilter.has(x) || !relFilter.has(y))) continue;
      const both = (pair.ab.has(x) && (pair.ab.has(y) || pair.ba.has(y))) || (pair.ba.has(x) && (pair.ab.has(y) || pair.ba.has(y)));
      if (both) {
        conflicts.push({
          entity_a: pair.a,
          entity_b: pair.b,
          field: "relations",
          description: `「${nameA}」与「${nameB}」同时存在 ${x} 与 ${y} 关系（互斥关系并存，设定矛盾）`,
        });
      }
    }
    // R3：互杀（双向 kills）
    if (relFilter === null || relFilter.has(KILLS_RELATION_TYPE)) {
      if (pair.ab.has(KILLS_RELATION_TYPE) && pair.ba.has(KILLS_RELATION_TYPE)) {
        conflicts.push({
          entity_a: pair.a,
          entity_b: pair.b,
          field: "relations",
          description: `「${nameA}」与「${nameB}」互相击杀（双向 ${KILLS_RELATION_TYPE}），死亡设定矛盾`,
        });
      }
    }
  }

  // 5. 稳定排序（entity_a 升序，再 entity_b 升序）——可预测输出
  conflicts.sort((x, y) => (x.entity_a === y.entity_a ? x.entity_b.localeCompare(y.entity_b) : x.entity_a.localeCompare(y.entity_a)));
  return { conflicts };
}
