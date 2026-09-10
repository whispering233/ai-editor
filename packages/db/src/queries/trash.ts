// @whispering233/ai-editor-db 回收站数据层（S4.1）：实体列表/级联还原/物理清除 + 级联 helper（自 server 下沉）
//
//
// 边界（与路由层的分工）：
// - 本模块只提供 data.db 侧原子操作；「先 DB 后 JSON」写序与 outline restore 的
// 祖先链 409 校验由路由层组合（S4.3 保持现状，不在本层实现）。
// - 「purge 仅用于回收站清理」（未软删拒绝）属路由层语义拦截，本层不校验
// （与 outline purge 路由的 isSoftDeleted 拦截同构）。
// - 可见性过滤（端点仍软删的关系/Delta 不可见）由查询层（relation.ts / entity.ts）负责，
// restore 层不做——全部还原，端点还原后自动可见。
//
// 级联 helper（cascadeRestore/cascadePurge）自 server/routes/outline.ts 下沉（trash.ts 注释
// 留痕的「S3 建模块后可下沉」项，S4.1 兑现）：参数与 SQL 语义不变，仅补充单库事务包裹。
//
// （15.2 试点）：**全部查询经 queryDb 走 drizzle 构建器**（本卡为试点模块，
// 混合风格 4A：本模块均为单一表条件更新/删除/查询，builder 表达清晰，无 sql 模板需求）。
// 语义逐句对照旧实现（git show d510f25^:packages/db/src/queries/trash.ts）：
// - deleted_at IS NOT NULL ↔ isNotNull；排序 desc(deleted_at) ↔ ORDER BY deleted_at DESC
// - (source_id = ? OR target_id = ?) ↔ or(eq,eq)；IN 占位符 ↔ inArray（空集自动恒假）
// - UPDATE ... WHERE 同列多重条件 ↔ and 组合；set({ deleted_at: null }) ↔ SET deleted_at = NULL
// - 幂等语义不变：存在性检查限定 deleted_at IS NOT NULL / UPDATE 均带软删过滤
// 事务沿用 withTransaction（native db.transaction）：drizzle 查询与 native 事务**连接级共享**——
// 同一连接上 builder 执行的语句在事务边界内，见 15.2 验证记录①。

import type { EntityType } from "@whispering233/ai-editor-shared";
import { eq, and, isNotNull, or, desc, inArray } from "drizzle-orm";
import { deltaRecords, entities, relationRecords } from "../tables.js";
import { nowIso } from "../storage/atomic.js";
import { withTransaction, type Db } from "../connection.js";
import { queryDb } from "../query-db.js";

/** 回收站实体条目（GET /api/v1/trash entities 项） */
export interface DeletedEntityInfo {
  id: string;
  type: EntityType;
  name: string;
  deletedAt: string;
}

/**
 * 回收站列表（实体侧，GET /api/v1/trash）：entities 表 deleted_at IS NOT NULL，
 * 按 deleted_at 倒序（回收站排序约定——ISO 字符串字典序即时间序，与 listDeletedNodes 一致）。
 * 常规查询默认过滤软删，回收站 API 是访问软删对象的唯一入口。
 */
export function listDeletedEntities(db: Db): DeletedEntityInfo[] {
  const q = queryDb(db);
  const rows = q
    .select({ id: entities.id, type: entities.type, name: entities.name, deletedAt: entities.deleted_at })
    .from(entities)
    .where(isNotNull(entities.deleted_at))
    .orderBy(desc(entities.deleted_at))
    .all();
 // drizzle 行映射：字段即 Shared 形态（snake→camel 在 select 别名处完成）
  return rows.map((r) => ({ id: r.id, type: r.type as EntityType, name: r.name, deletedAt: r.deletedAt as string }));
}

/**
 * 还原软删实体（POST /api/v1/trash/entity/:type/:id/restore）：
 * - 自身：deleted_at 置 NULL + **updated_at 刷新**（与常规编辑一致，
 * 保证 提案快照比对语义统一——还原后基于旧快照的提案必然 PROPOSAL_STALE）
 * - 关联关系：relation_records（source_id = id **或** target_id = id）deleted_at 置 NULL——
 * **全部还原**，不因另一端仍软删而跳过（数据永不丢失；端点仍软删的
 * 关系由查询层可见性过滤，端点还原后自动可见）
 * - 关联 Delta：delta_records（target_id = id）同规则
 * 单库事务（withTransaction，原子性）；幂等：实体不存在、类型不匹配或未软删 → 返回 null
 * 且无任何副作用（存在性检查限定 deleted_at IS NOT NULL，级联 UPDATE 均带
 * deleted_at IS NOT NULL 过滤——已还原的行不重复计数）。
 *
 * @param type 实体类型（路由路径参数；与 id 联合校验，类型不匹配视同不存在）
 * @returns { restoredRelations, restoredDeltas } 实际还原的级联行数；实体不在回收站返回 null
 */
export function restoreEntity(
  db: Db,
  type: EntityType,
  id: string,
): { restoredRelations: number; restoredDeltas: number } | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const exists = q
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, id), eq(entities.type, type), isNotNull(entities.deleted_at)))
      .get();
    if (exists === undefined) return null;
    const rel = q
      .update(relationRecords)
      .set({ deleted_at: null })
      .where(and(isNotNull(relationRecords.deleted_at), or(eq(relationRecords.source_id, id), eq(relationRecords.target_id, id))))
      .run();
    const delta = q
      .update(deltaRecords)
      .set({ deleted_at: null })
      .where(and(isNotNull(deltaRecords.deleted_at), eq(deltaRecords.target_id, id)))
      .run();
    q.update(entities)
      .set({ deleted_at: null, updated_at: nowIso() })
      .where(eq(entities.id, id))
      .run();
    return { restoredRelations: rel.changes, restoredDeltas: delta.changes };
  });
}

/**
 * 物理清除软删实体（DELETE /api/v1/trash/entity/:type/:id）：
 * 不可恢复——DELETE 实体本体 + 关联 relations（source_id = id 或 target_id = id）+
 * deltas（target_id = id）。单库事务。
 * 幂等：实体不存在或类型不匹配 → 返回 null 且无副作用。
 *
 * 注意：本层**不校验「必须已软删」**——「purge 仅用于回收站清理」的语义拦截由路由层负责
 * （S4.3，与 outline purge 的 isSoftDeleted 拦截同构），本层只保证原子物理清除。
 *
 * @returns true（清除成功）；实体不存在返回 null
 */
export function purgeEntity(db: Db, type: EntityType, id: string): true | null {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const exists = q.select({ id: entities.id }).from(entities).where(and(eq(entities.id, id), eq(entities.type, type))).get();
    if (exists === undefined) return null;
    q.delete(relationRecords).where(or(eq(relationRecords.source_id, id), eq(relationRecords.target_id, id))).run();
    q.delete(deltaRecords).where(eq(deltaRecords.target_id, id)).run();
    q.delete(entities).where(eq(entities.id, id)).run();
    return true;
  });
}

/**
 * 级联还原子树关联的 relation/delta（全部还原，不因另一端仍软删而跳过；
 * 自 server/routes/outline.ts 下沉，参数与 SQL 语义不变）：
 * - relations：source 或 target 命中子树任一节点 → deleted_at 置 NULL（含 plot_edge 画布连线）
 * - deltas：node_id 命中子树任一节点 → deleted_at 置 NULL（delta_records.node_id = 触发节点列）
 * @returns { relations, deltas } 实际还原数（UPDATE.changes）
 */
export function cascadeRestore(db: Db, subtreeIds: string[]): { relations: number; deltas: number } {
  return withTransaction(db, () => {
    const q = queryDb(db);
    const rel = q
      .update(relationRecords)
      .set({ deleted_at: null })
      .where(and(isNotNull(relationRecords.deleted_at), or(inArray(relationRecords.source_id, subtreeIds), inArray(relationRecords.target_id, subtreeIds))))
      .run();
    const delta = q
      .update(deltaRecords)
      .set({ deleted_at: null })
      .where(and(isNotNull(deltaRecords.deleted_at), inArray(deltaRecords.node_id, subtreeIds)))
      .run();
    return { relations: rel.changes, deltas: delta.changes };
  });
}

/**
 * 物理清除子树关联的 relation/delta（purge，物理清除且不可恢复；
 * 自 server/routes/outline.ts 下沉，参数与 SQL 语义不变）：
 * - relations：source 或 target 命中子树任一节点 → 物理删除
 * - deltas：node_id 命中子树任一节点 → 物理删除
 */
export function cascadePurge(db: Db, subtreeIds: string[]): void {
  withTransaction(db, () => {
    const q = queryDb(db);
    q.delete(relationRecords)
      .where(or(inArray(relationRecords.source_id, subtreeIds), inArray(relationRecords.target_id, subtreeIds)))
      .run();
    q.delete(deltaRecords).where(inArray(deltaRecords.node_id, subtreeIds)).run();
  });
}