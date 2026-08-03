// 启动一致性校验（S4.2）：软删联动兜底补标（决策 16 修订）
//
// 背景（决策 16 + 决策 12 可见性不变式）：软删大纲节点 = 先 DB 后 JSON——
//   1. DB 级联软删关联 relation/delta（routes/outline.ts cascadeSoftDelete）
//   2. outline.json 原子写节点 deleted 标记（deleteOutlineNode）
// 两步间崩溃/取消会留下「outline.json 节点已软删、DB 关联记录未软删」的幽灵形态
// （可见记录指向已软删节点，违反决策 12「任一端点软删即不可见」）。
// 本模块在**打开项目**时兜底：以大纲节点软删为准，将关联的 relation/delta 中
// 未软删记录补标 deleted_at（nowIso，schema.md 第 16 行应用层时间约定）。
//
// 边界（任务卡 S4.2，决策 16 修订）：
// - 只做「节点已软删 → DB 记录补标」单方向：决策 12 不变式是单向的（节点软删 ⇒
//   关联记录必软删），按节点软删补标无误报；反向（DB 记录已软删、节点未软删）推断
//   受实体侧级联干扰（softDeleteEntity 会级联软删节点↔实体关系而节点仍存活），
//   不可靠，不在本卡（留 S4.3/后续）。
// - 不触碰路由、无定时任务——仅由打开项目流程（startServer / POST /project/open）
//   显式调用；outline.json 损坏时跳过并 console.error（兜底不阻塞项目打开）。
//
// 幂等：UPDATE 均带 deleted_at IS NULL 过滤——一致状态返回零补标、无副作用，
// 可安全重复执行（二次打开项目零补标）。
import type { ProjectContext } from "./middleware/project.js";
import { listDeletedNodes, nowIso } from "@ai-editor/db";

/** 启动一致性校验结果（供调用方写日志，任务卡 S4.2） */
export interface SoftDeleteReconcileResult {
  /** outline.json 中已软删的节点数（本次比对的驱动集合） */
  deletedNodes: number;
  /** 补标的关系数（关联已软删节点但 DB 未软删的 relation_records） */
  relations: number;
  /** 补标的 Delta 数（node_id 命中已软删节点但 DB 未软删的 delta_records） */
  deltas: number;
}

/** 生成 SQL IN 占位符串（id 集来自服务端生成的 nanoid，无注入面；空集返回 "(NULL)" 恒假） */
function inPlaceholders(ids: string[]): string {
  return ids.length === 0 ? "(NULL)" : `(${ids.map(() => "?").join(",")})`;
}

/**
 * 打开项目时执行软删一致性校验（S4.2，决策 16 修订）：
 * 以 outline.json 节点软删为准，补标 DB 侧缺失的级联软删——
 * - relations：source 或 target 命中已软删节点 → 置 deleted_at（含 plot_edge，同决策 12 级联口径）
 * - deltas：node_id 命中已软删节点 → 置 deleted_at
 * SQL 与 routes/outline.ts cascadeSoftDelete 同构（端点 id 按前缀域隔离：节点 vol-/ch-/sc- 与
 * 实体 char-/set-/loc-/hook- 互斥，按 id 匹配即等价于按端点类型过滤）。
 *
 * 幂等：UPDATE 限定 deleted_at IS NULL → 一致状态零补标、无副作用。
 * 异常语义：outline.json 损坏（JSON.parse 抛错）时跳过本次校验并 console.error——
 * 打开流程此前不读 outline.json（readProjectFile 只读 project.json），兜底不得引入行为回退。
 *
 * @param project 已打开的项目上下文（root 供读 outline.json，db 供补标 SQL）
 * @returns { deletedNodes, relations, deltas } 补标计数（供调用方写日志）
 */
export function reconcileSoftDelete(project: ProjectContext): SoftDeleteReconcileResult {
  let deletedIds: string[];
  try {
    deletedIds = listDeletedNodes(project.root).map((n) => n.id);
  } catch (err) {
    console.error(
      `[consistency] outline.json 读取失败，跳过一致性校验: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { deletedNodes: 0, relations: 0, deltas: 0 };
  }
  if (deletedIds.length === 0) {
    return { deletedNodes: 0, relations: 0, deltas: 0 };
  }
  const deletedAt = nowIso(); // ISO 8601 应用层写入（schema.md 第 16 行）
  const rel = project.db
    .prepare(
      `UPDATE relation_records SET deleted_at = ? WHERE deleted_at IS NULL AND
       (source_id IN ${inPlaceholders(deletedIds)} OR target_id IN ${inPlaceholders(deletedIds)})`,
    )
    .run(deletedAt, ...deletedIds, ...deletedIds);
  const delta = project.db
    .prepare(
      `UPDATE delta_records SET deleted_at = ? WHERE deleted_at IS NULL AND node_id IN ${inPlaceholders(deletedIds)}`,
    )
    .run(deletedAt, ...deletedIds);
  return { deletedNodes: deletedIds.length, relations: rel.changes, deltas: delta.changes };
}

/**
 * 一致性校验结果日志（决策 16 修订「补标并写日志」）：
 * 仅在有已软删节点时输出（无软删节点 = 常规状态，不刷启动日志）；
 * 格式：`[consistency] outline 软删节点 N 个，补标 relation R / delta D`
 */
export function logSoftDeleteReconcile(result: SoftDeleteReconcileResult): void {
  if (result.deletedNodes > 0) {
    console.log(
      `[consistency] outline 软删节点 ${result.deletedNodes} 个，补标 relation ${result.relations} / delta ${result.deltas}`,
    );
  }
}
