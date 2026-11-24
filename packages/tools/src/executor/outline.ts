// 执行类工具：大纲（S6.7，「执行类」3 个 + C1 文本更新 1 个）
// create_outline_node / move_node / delete_node / update_outline_node（propose_update_outline_node 的确认侧）
//
// 写路径：直接调 db outline-ops（唯一写路径；outline.json 原子写由 db 层保证）；
// updatedAt 由应用层 nowIso 传入（时间约定：ISO 8601 应用层写入，模块不生成时间）。
// 层级约束（严格三层）由 db assertCanHold 兜底：scene 挂 chapter、chapter **只能挂卷**（2026-09）、
// volume 挂根；parent_id 缺省挂 root（**只有 volume 能缺省**，chapter/scene 缺省即拒绝——与提案层同语义）。
// 软删语义：delete_node 软删 + 递归子树（本体保留可回收站还原）。

import { createOutlineNode, deleteOutlineNode, moveOutlineNode, nowIso, updateOutlineNodeInfo } from "@whispering233/ai-editor-db";
import type { OutlineNodeType } from "@whispering233/ai-editor-shared";
import { requireChapterNode, requireOutlineNode } from "../proposal/types.js";
import { requireNumber, requireRecord, requireString, type ExecutorFn } from "./types.js";

/** create_outline_node（create_outline_node(type, title, parent) → id） */
export const executeCreateOutlineNode: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const parentId = args.parent_id === undefined ? "root" : requireString(args, "parent_id"); // 缺省挂根
  const node = createOutlineNode(ctx.outlineDir, {
    type: requireString(args, "type") as Exclude<OutlineNodeType, "root">,
    title: requireString(args, "title"),
    parentId,
    updatedAt: nowIso(),
  });
  return { id: node.id };
};

/** move_node（move_node(node_id, parent, order) → void；parent 可为 root） */
export const executeMoveNode: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const nodeId = requireString(args, "node_id");
  const result = moveOutlineNode(
    ctx.outlineDir,
    nodeId,
    {
      parentId: requireString(args, "parent_id"),
      order: requireNumber(args, "order"), // 越界由 db clamp（0..children.length）
    },
    nowIso(),
  );
  return { id: nodeId, ...result };
};

/** delete_node（delete_node(node_id) → void；软删 + 递归子树） */
export const executeDeleteNode: ExecutorFn = (ctx, proposal) => {
  const nodeId = requireString(proposal.args, "node_id");
  const { children } = deleteOutlineNode(ctx.outlineDir, nodeId, nowIso());
  return { id: nodeId, deleted: true, cascadedChildren: children };
};

/**
 * update_outline_node（propose_update_outline_node 的确认侧）：
 * `updateOutlineNodeInfo(dir, id, { title?, summary?, data? }, nowIso())`——`data` 由 db 层**浅合并**
 * （只换 `result_summary`，`tags` / `status` 等其他 data 字段原样保留）。
 * 存在且未软删由 `requireOutlineNode` 先挡（`updateOutlineNodeInfo` 自身不查软删）；
 * `result_summary` 仅章（与提案层双管，同 `requireChapterNode` 文案）。
 */
export const executeUpdateOutlineNode: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const nodeId = requireString(args, "node_id");
  const patches = requireRecord(args, "patches");
  const hasResultSummary = patches.result_summary !== undefined;
  const node = hasResultSummary
    ? requireChapterNode(ctx, nodeId, "实际摘要")
    : requireOutlineNode(ctx, nodeId);
  const patch: { title?: string; summary?: string; data?: Record<string, unknown> } = {};
  if (typeof patches.title === "string") patch.title = patches.title;
  if (typeof patches.summary === "string") patch.summary = patches.summary;
  if (hasResultSummary) {
 // 空串 = 清空（"" 与「无摘要」等价），仍写键——不做特例删字段
    if (typeof patches.result_summary !== "string") throw new Error("执行参数缺失或非法: result_summary");
    patch.data = { result_summary: patches.result_summary };
  }
  updateOutlineNodeInfo(ctx.outlineDir, nodeId, patch, nowIso());
  return { id: node.id, updated: true };
};
