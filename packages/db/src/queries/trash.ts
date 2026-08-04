// @whispering233/ai-editor-db 回收站数据层（S4.1）：实体列表/级联还原/物理清除 + 级联 helper（自 server 下沉）
//
// 单一事实来源：
// - doc/api/endpoints.md 第 660-736 行（回收站端点契约：GET /trash、POST restore、DELETE purge）
// - doc/design/decisions.md 决策 12（软删/级联还原/物理清除；2026-08 修订：软删/还原更新
//   updated_at；restore 级联还原全部关系不因另一端仍软删而跳过；手动删关系 = 物理删）
// - doc/ui/pages/trash.md（列表字段：entities[].{ id, type, name, deleted_at }，deleted_at 倒序）
//
// 边界（与路由层的分工）：
// - 本模块只提供 data.db 侧原子操作；「先 DB 后 JSON」写序（决策 16）与 outline restore 的
//   祖先链 409 校验由路由层组合（S4.3 保持现状，不在本层实现）。
// - 「purge 仅用于回收站清理」（未软删拒绝）属路由层语义拦截，本层不校验
//   （与 outline purge 路由的 isSoftDeleted 拦截同构）。
// - 可见性过滤（端点仍软删的关系/Delta 不可见）由查询层（relation.ts / entity.ts）负责，
//   restore 层不做——全部还原（决策 12 修订），端点还原后自动可见。
//
// 级联 helper（cascadeRestore/cascadePurge）自 server/routes/outline.ts 下沉（trash.ts 注释
// 留痕的「S3 建模块后可下沉」项，S4.1 兑现）：参数与 SQL 语义不变，仅补充单库事务包裹。

import type { EntityType } from "@whispering233/ai-editor-shared";
import { nowIso } from "../storage/atomic.js";
import { withTransaction, type Db } from "../connection.js";

/** 回收站实体条目（GET /api/v1/trash entities 项，endpoints.md 第 671 行） */
export interface DeletedEntityInfo {
  id: string;
  type: EntityType;
  name: string;
  deletedAt: string;
}

/**
 * 回收站列表（实体侧，GET /api/v1/trash）：entities 表 deleted_at IS NOT NULL，
 * 按 deleted_at 倒序（回收站排序约定——ISO 字符串字典序即时间序，与 listDeletedNodes 一致）。
 * 常规查询默认过滤软删（决策 12），回收站 API 是访问软删对象的唯一入口。
 */
export function listDeletedEntities(db: Db): DeletedEntityInfo[] {
  const rows = db
    .prepare("SELECT id, type, name, deleted_at FROM entities WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
    .all() as Array<{ id: string; type: EntityType; name: string; deleted_at: string }>;
  return rows.map((r) => ({ id: r.id, type: r.type, name: r.name, deletedAt: r.deleted_at }));
}

/**
 * 还原软删实体（POST /api/v1/trash/entity/:type/:id/restore，endpoints.md 第 676-692 行，决策 12 修订）：
 * - 自身：deleted_at 置 NULL + **updated_at 刷新**（决策 12 修订：与常规编辑一致，
 *   保证决策 14 提案快照比对语义统一——还原后基于旧快照的提案必然 PROPOSAL_STALE）
 * - 关联关系：relation_records（source_id = id **或** target_id = id）deleted_at 置 NULL——
 *   **全部还原**，不因另一端仍软删而跳过（决策 12 修订：数据永不丢失；端点仍软删的
 *   关系由查询层可见性过滤，端点还原后自动可见）
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
    const exists = db
      .prepare("SELECT id FROM entities WHERE id = ? AND type = ? AND deleted_at IS NOT NULL")
      .get(id, type);
    if (exists === undefined) return null;
    const rel = db
      .prepare(
        `UPDATE relation_records SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND (source_id = ? OR target_id = ?)`,
      )
      .run(id, id);
    const delta = db
      .prepare(`UPDATE delta_records SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND target_id = ?`)
      .run(id);
    db.prepare("UPDATE entities SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
    return { restoredRelations: rel.changes, restoredDeltas: delta.changes };
  });
}

/**
 * 物理清除软删实体（DELETE /api/v1/trash/entity/:type/:id，endpoints.md 第 713-724 行）：
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
    const exists = db.prepare("SELECT id FROM entities WHERE id = ? AND type = ?").get(id, type);
    if (exists === undefined) return null;
    db.prepare("DELETE FROM relation_records WHERE source_id = ? OR target_id = ?").run(id, id);
    db.prepare("DELETE FROM delta_records WHERE target_id = ?").run(id);
    db.prepare("DELETE FROM entities WHERE id = ?").run(id);
    return true;
  });
}

/** 生成 SQL IN 占位符串（id 集来自服务端生成的 nanoid，无注入面；空集返回 "(NULL)" 恒假） */
function inPlaceholders(ids: string[]): string {
  return ids.length === 0 ? "(NULL)" : `(${ids.map(() => "?").join(",")})`;
}

/**
 * 级联还原子树关联的 relation/delta（决策 12 修订：全部还原，不因另一端仍软删而跳过；
 * 自 server/routes/outline.ts 下沉，参数与 SQL 语义不变）：
 * - relations：source 或 target 命中子树任一节点 → deleted_at 置 NULL（含 plot_edge 画布连线）
 * - deltas：node_id 命中子树任一节点 → deleted_at 置 NULL（delta_records.node_id = 触发节点列）
 * @returns { relations, deltas } 实际还原数（UPDATE.changes）
 */
export function cascadeRestore(db: Db, subtreeIds: string[]): { relations: number; deltas: number } {
  return withTransaction(db, () => {
    const rel = db
      .prepare(
        `UPDATE relation_records SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND
         (source_id IN ${inPlaceholders(subtreeIds)} OR target_id IN ${inPlaceholders(subtreeIds)})`,
      )
      .run(...subtreeIds, ...subtreeIds);
    const delta = db
      .prepare(`UPDATE delta_records SET deleted_at = NULL WHERE deleted_at IS NOT NULL AND node_id IN ${inPlaceholders(subtreeIds)}`)
      .run(...subtreeIds);
    return { relations: rel.changes, deltas: delta.changes };
  });
}

/**
 * 物理清除子树关联的 relation/delta（purge，决策 12：物理清除且不可恢复；
 * 自 server/routes/outline.ts 下沉，参数与 SQL 语义不变）：
 * - relations：source 或 target 命中子树任一节点 → 物理删除
 * - deltas：node_id 命中子树任一节点 → 物理删除
 */
export function cascadePurge(db: Db, subtreeIds: string[]): void {
  withTransaction(db, () => {
    db.prepare(
      `DELETE FROM relation_records WHERE source_id IN ${inPlaceholders(subtreeIds)} OR target_id IN ${inPlaceholders(subtreeIds)}`,
    ).run(...subtreeIds, ...subtreeIds);
    db.prepare(`DELETE FROM delta_records WHERE node_id IN ${inPlaceholders(subtreeIds)}`).run(...subtreeIds);
  });
}
