// 查询类工具：大纲侧实现（S6.3）
// get_outline / get_outline_path（tools.md「大纲查询」）
// 契约来源：doc/api/tools.md；doc/api/endpoints.md 大纲端点；决策 12 修订（默认过滤软删）、
//   决策 19（严格三层，无游离节点）。
//
// db 层能力确认与分工：
// - get_outline：db readOutlineFile 返回存储形态 OutlineFileTree——
//   工具层 mapOutlineFileToTree 映射为 API 形态（camelCase）；**默认不含 metadata**
//   （省 token，tools.md 明确：需统计走 API with_metadata）；软删节点整棵剔除
//   （决策 12 修订：查询类工具不返回回收站中的对象）
// - get_outline_path：db getOutlinePathIds 返回根 → 目标节点路径（含 root）；
//   节点不存在抛错——工具层转 null（查询无结果）；路径上任一节点软删 → null（不可见）

import { findOutlineNode, getOutlinePathIds, readOutlineFile } from "@whispering233/ai-editor-db";
import { mapOutlineFileToTree } from "@whispering233/ai-editor-shared";
import type { OutlineFileNode, OutlineTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import type { GetOutlinePathArgs } from "@whispering233/ai-editor-shared";

/**
 * 递归剔除软删节点（决策 12 修订）：deleted === true 的节点整棵不可见——
 * 级联软删（决策 12）保证其子树已一并软删，但防御性仍剔除整棵子树
 * （手改 outline.json 可能产生不一致，查询层不因脏数据暴露回收站对象）。
 * 泛型 T 保持调用处的节点联合类型（root 层 volume|chapter，递归层逐级收窄）。
 */
function stripDeletedNodes<T extends OutlineFileNode>(nodes: readonly T[]): T[] {
  const out: T[] = [];
  for (const node of nodes) {
    if (node.deleted === true) continue;
    const children = (node as { children?: readonly OutlineFileNode[] }).children;
    out.push(children === undefined ? node : ({ ...node, children: stripDeletedNodes(children) } as T));
  }
  return out;
}

/**
 * 完整大纲树（tools.md get_outline() → 严格三层树，决策 19）。
 * - 默认不含 metadata 统计（省 token；需统计走 API GET /outline?with_metadata=）
 * - 软删节点过滤（决策 12 修订）
 * - 返回 API 形态 OutlineTree（camelCase；data 嵌套字段原样透传）
 * 无参工具：签名省略 args（少参数赋值兼容 ToolDefinition.run，避免未使用参数 lint）
 */
export function runGetOutline(ctx: ToolContext): OutlineTree {
  const tree = readOutlineFile(ctx.outlineDir);
  const stripped = { ...tree, children: stripDeletedNodes(tree.children) };
  return mapOutlineFileToTree(stripped);
}

/**
 * 根 → 目标节点的路径 ID 列表（tools.md get_outline_path(node_id)，含 root，
 * 如 ["root", "vol-1", "ch-3", "sc-15"]；严格三层下路径唯一，决策 19）。
 * - 节点不存在 → null（db getOutlinePathIds 抛错，工具层转查询无结果）
 * - 路径上任一节点软删 → null（决策 12 修订：软删对象不可见——目标节点软删时
 *   其路径对 AI 无意义；防御手改 outline.json 产生的祖先软删不一致）
 */
export function runGetOutlinePath(ctx: ToolContext, args: GetOutlinePathArgs): string[] | null {
  const tree = readOutlineFile(ctx.outlineDir);
  let path: string[];
  try {
    path = getOutlinePathIds(tree, args.node_id);
  } catch {
    return null; // 节点不存在（getOutlinePathIds 抛错语义，见 db 注释）
  }
  for (const nodeId of path) {
    if (nodeId === "root") continue; // root 非节点，无软删概念
    const node = findOutlineNode(tree, nodeId);
    if (node?.deleted === true) return null;
  }
  return path;
}
