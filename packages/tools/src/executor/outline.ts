// 执行类工具：大纲（S6.7，「执行类」3 个）
// create_outline_node / move_node / delete_node
//
// 写路径：直接调 db outline-ops（唯一写路径；outline.json 原子写由 db 层保证）；
// updatedAt 由应用层 nowIso 传入（时间约定：ISO 8601 应用层写入，模块不生成时间）。
// 层级约束（严格三层）由 db assertCanHold 兜底：scene 挂 chapter、chapter 挂卷/根、
// volume 挂根；parent_id 缺省挂 root（volume/chapter 可挂根，scene 缺省即拒绝——与提案层同语义）。
// 软删语义：delete_node 软删 + 递归子树（本体保留可回收站还原）。

import { createOutlineNode, deleteOutlineNode, moveOutlineNode, nowIso } from "@whispering233/ai-editor-db";
import type { OutlineNodeType } from "@whispering233/ai-editor-shared";
import { requireNumber, requireString, type ExecutorFn } from "./types.js";

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
