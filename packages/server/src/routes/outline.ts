// 大纲路由（S2.2）：GET/POST /outline、PUT /outline/:nodeId、PUT move、DELETE、GET path
//
// 契约来源：doc/api/endpoints.md 第 516-657 行（大纲操作）、决策 12（软删/级联）、决策 19（严格三层）。
// 错误映射（db OutlineError → HttpError，对照 endpoints.md 错误码）：
//   NODE_NOT_FOUND             → 404 OUTLINE_NODE_NOT_FOUND
//   PARENT_NOT_FOUND           → 400 OUTLINE_NODE_NOT_FOUND（父不存在是参数问题，非资源访问）
//   INVALID_HIERARCHY          → 400 VALIDATION_ERROR（严格三层违反）
//   OUTLINE_ANCESTOR_DELETED   → 409 OUTLINE_ANCESTOR_DELETED（决策 12 修订）
// 说明：级联还原/物理清除（cascadeRestore/cascadePurge）已下沉 db 包 queries/trash.ts（S4.1）；
//   级联软删（cascadeSoftDelete）保留在路由层——与软删端点同文件内联，S4.1 任务边界只下沉
//   还原/清除两个 helper（trash.ts 路由直接 import @ai-editor/db）。
import { Hono } from "hono";
import type { Db } from "@ai-editor/db";
import { readOutlineFile } from "@ai-editor/db";
import { getOutlinePathIds } from "@ai-editor/db";
import {
  createOutlineNode,
  deleteOutlineNode,
  moveOutlineNode,
  OutlineError,
  updateOutlineNodeInfo,
} from "@ai-editor/db";
import type { OutlineFileNode, OutlineFileTree, OutlineNode, OutlineTree } from "@ai-editor/shared";
import { HOOK_RELATION_TYPES, mapOutlineFileToTree } from "@ai-editor/shared";
import { nowIso } from "@ai-editor/db";
import {
  outlineCreateReqSchema,
  outlineGetQuerySchema,
  outlineMoveReqSchema,
  outlineUpdateReqSchema,
} from "@ai-editor/shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";

/** 大纲路由（挂载于 /api/v1/outline，index.ts） */
export const outlineRoutes = new Hono();

/** 递归过滤软删节点（决策 12：常规查询默认过滤；deleted 节点整棵子树丢弃） */
function filterDeletedTree(tree: OutlineFileTree): OutlineFileTree {
  const filterNodes = (nodes: readonly OutlineFileNode[]): OutlineFileNode[] =>
    nodes
      .filter((n) => n.deleted !== true)
      .map((n) => {
        const kids = (n as { children?: OutlineFileNode[] }).children;
        return (kids === undefined ? { ...n } : { ...n, children: filterNodes(kids) }) as OutlineFileNode;
      });
  // 递归产物为宽 OutlineFileNode[]，结构上满足严格三层（输入树合法 ⇒ 过滤后仍合法），
  // 此处断言收窄回 OutlineFileTree（storage 形态判别联合的已知递归映射限制）
  return { ...tree, children: filterNodes(tree.children) } as OutlineFileTree;
}

/** 收集 nodeId 及其整棵子树的 id 集（含自身；供 relation/delta 级联软删/还原/清除用） */
export function collectSubtreeIds(tree: OutlineFileTree, nodeId: string): string[] {
  const ids: string[] = [];
  const visit = (nodes: readonly OutlineFileNode[]): boolean => {
    for (const n of nodes) {
      if (n.id === nodeId || visit((n as { children?: OutlineFileNode[] }).children ?? [])) {
        ids.push(n.id);
        return true;
      }
    }
    return false;
  };
  if (visit(tree.children)) return ids;
  throw new HttpError(404, "OUTLINE_NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
}

/** 生成 SQL IN 占位符串（id 集来自服务端生成的 nanoid，无注入面；空集返回 "(NULL)" 恒假） */
export function inPlaceholders(ids: string[]): string {
  return ids.length === 0 ? "(NULL)" : `(${ids.map(() => "?").join(",")})`;
}

/**
 * 级联软删该节点及子树关联的 relation/delta（决策 12：任一端点软删即不可见）：
 * - relations：source 或 target 命中子树任一节点 → 标 deleted_at（含 plot_edge 画布连线）
 * - deltas：node_id 命中子树任一节点 → 标 deleted_at
 * 返回 { relations, deltas } 实际级联数（UPDATE.changes）。
 */
function cascadeSoftDelete(db: Db, subtreeIds: string[], deletedAt: string): { relations: number; deltas: number } {
  const rel = db
    .prepare(
      `UPDATE relation_records SET deleted_at = ? WHERE deleted_at IS NULL AND
       (source_id IN ${inPlaceholders(subtreeIds)} OR target_id IN ${inPlaceholders(subtreeIds)})`,
    )
    .run(deletedAt, ...subtreeIds, ...subtreeIds);
  const delta = db
    .prepare(`UPDATE delta_records SET deleted_at = ? WHERE deleted_at IS NULL AND node_id IN ${inPlaceholders(subtreeIds)}`)
    .run(deletedAt, ...subtreeIds);
  return { relations: rel.changes, deltas: delta.changes };
}

// GET /api/v1/outline —— 完整大纲树（软删过滤；with_metadata=true 联查统计）
outlineRoutes.get("/", (c) => {
  const project = requireCurrentProject();
  const query = outlineGetQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    throw query.error;
  }
  const tree = readOutlineFile(project.root);
  // shared 映射（oracle 回修后支持决策 19「chapter 直挂 root」——换回 mapOutlineFileToTree，
  // 删除 S2.2 的自写 mapTreeToApi 绕过）
  const apiTree = mapOutlineFileToTree(filterDeletedTree(tree));
  if (query.data.with_metadata === true) {
    attachMetadata(apiTree, project.db);
  }
  return c.json(ok(apiTree));
});

/**
 * with_metadata 联查统计（跨 outline.json × data.db，endpoints.md 第 523 行）：
 * - hookCount：该节点出发的伏笔管理关系（plants/advances/resolves，source=outline_node → hook，hooks.md）
 * - charCount：appears_in 指向该节点的关系数（决策 2 示例：char → 大纲节点）
 * - deltaCount：该节点触发的 Delta 数（delta_records.node_id）
 * 均为运行时计算，不写回数据（决策 21 _health 同款口径）。
 */
function attachMetadata(tree: OutlineTree, db: Db): void {
  const hookStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM relation_records
     WHERE source_type = 'outline_node' AND source_id = ?
       AND relation_type IN (${HOOK_RELATION_TYPES.map(() => "?").join(",")})
       AND deleted_at IS NULL`,
  );
  const charStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM relation_records
     WHERE target_type = 'outline_node' AND target_id = ? AND relation_type = 'appears_in'
       AND deleted_at IS NULL`,
  );
  const deltaStmt = db.prepare(
    `SELECT COUNT(*) AS c FROM delta_records WHERE node_id = ? AND deleted_at IS NULL`,
  );
  const visit = (node: OutlineNode): void => {
    const metadata: NonNullable<OutlineNode["metadata"]> = {};
    metadata.hookCount = (hookStmt.get(node.id, ...HOOK_RELATION_TYPES) as { c: number }).c;
    metadata.charCount = (charStmt.get(node.id) as { c: number }).c;
    metadata.deltaCount = (deltaStmt.get(node.id) as { c: number }).c;
    node.metadata = metadata;
    for (const child of (node as { children?: OutlineNode[] }).children ?? []) visit(child);
  };
  for (const vol of tree.children) visit(vol);
}

// POST /api/v1/outline —— 创建节点（严格三层，parent_id 必填，决策 19）
outlineRoutes.post("/", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = outlineCreateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → 400 VALIDATION_ERROR（含 fields）
  }
  const { type, title, parent_id, summary } = parsed.data;
  let node: OutlineFileNode;
  try {
    node = createOutlineNode(project.root, { type, title, parentId: parent_id, summary, updatedAt: nowIso() });
  } catch (err) {
    throw mapOutlineError(err);
  }
  return c.json(
    ok({
      id: node.id,
      type: node.type,
      title: node.title,
      parentId: parent_id,
      updatedAt: node.updated_at,
    }),
    201,
  );
});

// PUT /api/v1/outline/:nodeId —— 更新标题/描述
outlineRoutes.put("/:nodeId", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = outlineUpdateReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  try {
    updateOutlineNodeInfo(project.root, c.req.param("nodeId"), parsed.data, nowIso());
  } catch (err) {
    throw mapOutlineError(err);
  }
  return c.json(ok({ updated: true as const }));
});

// PUT /api/v1/outline/:nodeId/move —— 移动/重排（严格三层约束同创建）
outlineRoutes.put("/:nodeId/move", async (c) => {
  const project = requireCurrentProject();
  const raw = await c.req.json().catch(() => null);
  const parsed = outlineMoveReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error;
  }
  let result: { previousParentId: string; newParentId: string };
  try {
    result = moveOutlineNode(
      project.root,
      c.req.param("nodeId"),
      { parentId: parsed.data.parent_id, order: parsed.data.order }, // snake_case → camelCase
      nowIso(),
    );
  } catch (err) {
    throw mapOutlineError(err);
  }
  return c.json(ok({ moved: true as const, ...result }));
});

// DELETE /api/v1/outline/:nodeId —— 软删 + 递归级联（决策 12）
// 写序（决策 16）：**先 DB 后 JSON**——先级联软删 relation/delta，再原子写 outline.json；
// 崩溃残留方向（DB 已级联、JSON 未标，节点未标 deleted）：无法从 DB 记录可靠反推
// （实体侧级联会软删节点↔实体关系而节点仍存活），不在 S4.2 补标范围；
// S4.2 启动一致性校验（consistency.ts）兜底幽灵反向：节点已软删而关联 relation/delta
// 未软删 → 以节点软删为准补标 DB 记录（决策 16 修订，幂等自愈）
outlineRoutes.delete("/:nodeId", (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("nodeId");
  const tree = readOutlineFile(project.root);
  const subtreeIds = collectSubtreeIds(tree, nodeId); // 404 语义
  const deletedAt = nowIso();
  // 1. DB 级联软删关联关系与 Delta（决策 12：节点/端点软删即不可见）
  const { relations, deltas } = cascadeSoftDelete(project.db, subtreeIds, deletedAt);
  // 2. JSON 原子写（软删节点 + 递归子树，决策 19 版本戳）
  let children: number;
  try {
    children = deleteOutlineNode(project.root, nodeId, deletedAt).children;
  } catch (err) {
    throw mapOutlineError(err);
  }
  return c.json(ok({ deleted: true as const, cascaded: { children, relations, deltas } }));
});

// GET /api/v1/outline/:nodeId/path —— 根 → 节点路径
outlineRoutes.get("/:nodeId/path", (c) => {
  const project = requireCurrentProject();
  const nodeId = c.req.param("nodeId");
  const tree = readOutlineFile(project.root);
  let path: string[];
  try {
    path = getOutlinePathIds(tree, nodeId);
  } catch {
    throw new HttpError(404, "OUTLINE_NODE_NOT_FOUND", `大纲节点不存在: ${nodeId}`);
  }
  return c.json(ok({ nodeId, path }));
});

/** OutlineError → HttpError 映射（对照 endpoints.md 错误码，文件头注释表） */
export function mapOutlineError(err: unknown): never {
  if (err instanceof OutlineError) {
    switch (err.code) {
      case "NODE_NOT_FOUND":
        throw new HttpError(404, "OUTLINE_NODE_NOT_FOUND", err.message);
      case "PARENT_NOT_FOUND":
        throw new HttpError(400, "OUTLINE_NODE_NOT_FOUND", err.message);
      case "INVALID_HIERARCHY":
        throw new HttpError(400, "VALIDATION_ERROR", err.message);
      case "OUTLINE_ANCESTOR_DELETED":
        throw new HttpError(409, "OUTLINE_ANCESTOR_DELETED", err.message);
    }
  }
  throw err instanceof Error ? err : new HttpError(500, "INTERNAL_ERROR", "大纲操作失败");
}
