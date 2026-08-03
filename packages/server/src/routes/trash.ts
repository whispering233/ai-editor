// 回收站路由（S2.2 大纲侧 + S4.3 实体侧）：GET /trash、restore 实体/节点、purge 实体/节点
//
// 契约来源：doc/api/endpoints.md 第 660-736 行、决策 12（软删/级联还原/物理清除）。
// 组织说明：大纲侧（S2.2）与实体侧（S4.3）同文件；relation/delta 级联 helper 在 db 包
// queries/trash.ts（S4.1 下沉）；实体 restore/purge 为纯 DB 操作（无 outline.json 侧），
// 写序天然满足「先 DB 后 JSON」（决策 16）。
// restore 祖先链校验（大纲侧）：存在软删祖先 → 409 OUTLINE_ANCESTOR_DELETED（决策 12 修订）。
// purge 语义拦截（两侧同构）：未软删对象拒绝 purge——仅用于回收站清理。
import { Hono } from "hono";
import { cascadePurge, cascadeRestore, getOutlinePathIds, readOutlineFile } from "@ai-editor/db";
import { listDeletedEntities, listDeletedNodes, purgeEntity, purgeOutlineNode, restoreEntity, restoreOutlineNode } from "@ai-editor/db";
import type { OutlineFileNode, OutlineFileTree } from "@ai-editor/shared";
import { nowIso } from "@ai-editor/db";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";
import { collectSubtreeIds, mapOutlineError } from "./outline.js";
import { parseTypeParam } from "./entity.js";

/** 回收站路由（挂载于 /api/v1/trash，index.ts） */
export const trashRoutes = new Hono();

// GET /api/v1/trash —— 回收站列表（大纲侧 + 实体侧，endpoints.md 第 664-674 行）
trashRoutes.get("/", (c) => {
  const project = requireCurrentProject();
  const nodes = listDeletedNodes(project.root).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    deletedAt: n.deleted_at,
  }));
  // 实体侧：db 层 listDeletedEntities 已返回 camelCase deletedAt（S4.1），直接透传
  return c.json(ok({ entities: listDeletedEntities(project.db), nodes }));
});

// POST /api/v1/trash/outline/:nodeId/restore —— 还原（级联还原子树 + 关联关系与 Delta）
// 写序（决策 16）：**先 DB 后 JSON**——先级联还原 relation/delta，再原子写 outline.json。
// 祖先链预校验必须在 DB 级联**之前**：409 拒绝的请求不产生任何副作用
// （restoreOutlineNode 内部的校验在 JSON 写前，但 DB 已先行——此处路由层先拦截）
trashRoutes.post("/outline/:nodeId/restore", (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("nodeId");
  const tree = readOutlineFile(project.root);
  const subtreeIds = collectSubtreeIds(tree, nodeId); // 404 语义
  // 0. 祖先链预校验（决策 12 修订）：存在软删祖先 → 409，且不产生任何 DB 副作用
  const path = getOutlinePathIds(tree, nodeId);
  for (const ancestorId of path.slice(1, -1)) {
    const ancestor = findNodeById(tree, ancestorId);
    if (ancestor?.deleted === true) {
      throw new HttpError(409, "OUTLINE_ANCESTOR_DELETED", `存在软删祖先 ${ancestorId}，请先还原祖先再还原本节点`);
    }
  }
  // 1. DB 级联还原（决策 12 修订：全部还原，不因另一端仍软删而跳过）
  const { relations, deltas } = cascadeRestore(project.db, subtreeIds);
  // 2. JSON 原子写（还原节点 + 递归子树；db 层校验为双保险）
  let restoredChildren: number;
  try {
    restoredChildren = restoreOutlineNode(project.root, nodeId, nowIso()).children;
  } catch (err) {
    throw mapOutlineError(err); // OUTLINE_ANCESTOR_DELETED → 409（预校验后不可达，防御）
  }
  return c.json(ok({ restored: true as const, restoredChildren, restoredRelations: relations, restoredDeltas: deltas }));
});

// DELETE /api/v1/trash/outline/:nodeId —— 物理清除（purge，不可恢复；仅用于回收站清理）
// 写序（决策 16）：**先 DB 后 JSON**——先物理清除 relation/delta，再原子写 outline.json
trashRoutes.delete("/outline/:nodeId", (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("nodeId");
  const tree = readOutlineFile(project.root);
  const subtreeIds = collectSubtreeIds(tree, nodeId); // 404 语义
  // 回收站语义拦截（oracle 审核建议）：purge 仅用于回收站清理——节点未软删拒绝，
  // 防误调把未进回收站的数据物理清掉
  if (!isSoftDeleted(tree, nodeId)) {
    throw new HttpError(400, "VALIDATION_ERROR", `节点未软删，purge 仅用于回收站清理: ${nodeId}`);
  }
  // 1. DB 物理清除关联关系与 Delta
  cascadePurge(project.db, subtreeIds);
  // 2. JSON 原子写（移除整棵子树；物理删除的极端崩溃窗口：DB 已清、JSON 未清，
  //    不在 S4.2 一致性校验范围——其只兜软删联动（决策 16 修订），同步操作中途
  //    崩溃概率极低，注释明示）
  purgeOutlineNode(project.root, nodeId);
  return c.json(ok({ purged: true as const }));
});

// POST /api/v1/trash/entity/:type/:id/restore —— 还原软删实体（endpoints.md 第 676-692 行，决策 12 修订）
// 纯 DB 操作：自身 deleted_at 置 NULL + updated_at 刷新（S4.1 db 层），级联还原关联关系与 Delta
// （全部还原，不因另一端仍软删而跳过——可见性由查询层兜底，端点还原后自动可见）。
// db 层幂等：实体不存在、类型不匹配或未软删 → null → 404（endpoints.md 第 689 行）。
trashRoutes.post("/entity/:type/:id/restore", (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const id = c.req.param("id");
  const result = restoreEntity(project.db, type, id);
  if (result === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在或未软删: ${id}`);
  }
  return c.json(
    ok({ restored: true as const, restoredRelations: result.restoredRelations, restoredDeltas: result.restoredDeltas }),
  );
});

// DELETE /api/v1/trash/entity/:type/:id —— 物理清除（purge，endpoints.md 第 713-724 行；不可恢复，
// 仅用于回收站清理）。拦截顺序与 outline purge 同构：先 404（不存在）后 400（未软删）——
// 未软删对象拒绝，防误调把未进回收站的数据物理清掉（oracle 审核建议）。
trashRoutes.delete("/entity/:type/:id", (c) => {
  const project = requireCurrentProject();
  const type = parseTypeParam(c.req.param("type"));
  const id = c.req.param("id");
  // 存在性 + 软删状态检查（原始 SQL：路由守卫，S4.1 purgeEntity 明确不校验「必须已软删」，
  //   outline purge 的 isSoftDeleted 同构——db 层只保证原子物理清除）
  const row = project.db
    .prepare("SELECT deleted_at FROM entities WHERE id = ? AND type = ?")
    .get(id, type) as { deleted_at: string | null } | undefined;
  if (row === undefined) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`);
  }
  if (row.deleted_at === null) {
    throw new HttpError(400, "VALIDATION_ERROR", `实体未软删，purge 仅用于回收站清理: ${id}`);
  }
  if (purgeEntity(project.db, type, id) === null) {
    throw new HttpError(404, "ENTITY_NOT_FOUND", `实体不存在: ${id}`); // 防御（上一步已确认存在）
  }
  return c.json(ok({ purged: true as const }));
});

/** 从树中按 id 找节点（restore 祖先预校验 / purge 拦截用；不存在由 collectSubtreeIds 先抛 404） */
function findNodeById(tree: OutlineFileTree, nodeId: string): OutlineFileNode | undefined {
  const visit = (nodes: readonly OutlineFileNode[]): OutlineFileNode | undefined => {
    for (const n of nodes) {
      if (n.id === nodeId) return n;
      const found = visit((n as { children?: readonly OutlineFileNode[] }).children ?? []);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(tree.children);
}

/** 判断节点是否已软删（purge 拦截校验用） */
function isSoftDeleted(tree: OutlineFileTree, nodeId: string): boolean {
  return findNodeById(tree, nodeId)?.deleted === true;
}
