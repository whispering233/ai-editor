// 分析类工具：trace_plot_paths（剧情路径推演，S6.4）
// 契约来源：doc/api/tools.md「路径分析」→ { paths: [{ nodes: [], description, risk_factors: [] }] }
// 语义：从 from_node_id 到 to_node_id 推演可能的剧情路径——两类来源：
// 1. **树路径**：两节点在大纲树同一分支（祖先后裔关系）→ 沿树的直接推进链（决策 19 严格三层下唯一）
// 2. **连线路径**：沿 plot_edge 剧情连线（决策 10 画布连线）从 from 出发的 k 跳路径（depth=3）
// 风险因素（risk_factors，从节点属性推导）：路径过长（≥5 节点）、途经 scene 缺 goal、
//   途经 chapter 缺 reversal、路径经过软删节点（手改树的不一致形态）。
// 数据访问：db 查询层（listRelations plot_edge）+ outline.json 读取（树路径），无原生 SQL。

import { findOutlineNode, getOutlinePathIds, listRelations, readOutlineFile } from "@whispering233/ai-editor-db";
import type { OutlineFileNode, OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { throwIfAborted } from "./utils.js";
import type { TracePlotPathsArgs } from "@whispering233/ai-editor-shared";

/** 路径节点（tools.md trace_plot_paths paths[].nodes 项；type/id/name 与 relation 路径同构） */
export interface PlotPathNode {
  type: string;
  id: string;
  name: string;
}

/** 一条剧情路径（tools.md trace_plot_paths paths[] 项） */
export interface PlotPath {
  nodes: PlotPathNode[];
  description: string;
  risk_factors: string[];
}

/** 节点信息（type/id/name=title；root 防御：name 用 "root" 占位） */
function nodeInfo(node: OutlineFileNode | undefined, id: string): PlotPathNode {
  if (node === undefined) return { type: "outline_node", id, name: id }; // 脏引用防御（树外 id）
  return { type: node.type, id: node.id, name: node.title };
}

/**
 * 树路径推导：若 from 是 to 的祖先 → 顺向链（from → to）；若 to 是 from 的祖先 → 回溯链（from → to）。
 * 两节点在不同分支（无祖先后裔关系）→ null（无树路径，靠连线路径）。
 * root 非可寻址大纲节点 → null。
 */
function treeSubPath(
  tree: OutlineFileTree,
  fromId: string,
  toId: string,
): { nodes: PlotPathNode[]; backward: boolean } | null {
  if (fromId === "root" || toId === "root") return null;
  let fromPath: string[];
  let toPath: string[];
  try {
    fromPath = getOutlinePathIds(tree, fromId);
    toPath = getOutlinePathIds(tree, toId);
  } catch {
    return null; // 节点不存在（getOutlinePathIds 抛错语义）
  }
  const fromIdx = toPath.indexOf(fromId); // from 在 to 的路径上（from 是 to 祖先）
  if (fromIdx !== -1) {
    return { nodes: toPath.slice(fromIdx).map((id) => nodeInfo(findOutlineNode(tree, id), id)), backward: false };
  }
  const toIdx = fromPath.indexOf(toId); // to 在 from 的路径上（to 是 from 祖先）
  if (toIdx !== -1) {
    return { nodes: fromPath.slice(toIdx).reverse().map((id) => nodeInfo(findOutlineNode(tree, id), id)), backward: true };
  }
  return null; // 不同分支
}

/**
 * 风险因素收集（树路径与连线路径共用）：从节点属性推导推进风险。
 * - 路径过长（≥4 节点）→ 中段易拖沓（连线路径 3 跳 = depth=3 推演上限，已达全量深度；
 *   树路径最多 3 层不触发）
 * - scene 缺 data.goal（麦基字段集，决策 23）→ 场景缺乏目标
 * - chapter 缺 data.reversal → 章节缺乏反转
 * - 途经软删节点（手改 outline.json 的不一致形态）→ 数据不一致
 */
function collectRiskFactors(tree: OutlineFileTree, nodes: readonly PlotPathNode[]): string[] {
  const risks: string[] = [];
  if (nodes.length >= 4) {
    risks.push(`路径过长（${nodes.length} 个节点），中段易拖沓，建议拆分为多幕推进`);
  }
  for (const n of nodes) {
    const node = findOutlineNode(tree, n.id);
    if (node === undefined) {
      risks.push(`路径经过不存在的节点 ${n.id}（数据不一致）`);
      continue;
    }
    if (node.type === "scene" && node.data?.goal === undefined) {
      risks.push(`场景「${node.title}」未定义目标（goal），推进缺乏动机`);
    }
    if (node.type === "chapter" && node.data?.reversal === undefined) {
      risks.push(`章「${node.title}」未定义反转（reversal），高潮乏力`);
    }
    if (node.deleted === true) {
      risks.push(`路径经过已软删节点「${node.title}」（数据不一致，建议先还原）`);
    }
  }
  return risks;
}

/**
 * 剧情路径推演（tools.md trace_plot_paths(from_node_id, to_node_id)）。
 * 输出 paths（树路径优先，随后连线路径）；两节点不存在/已软删 → null（查询无结果）。
 * signal：连线路径遍历为长任务候选，循环中检查（决策 16 ③）。
 */
export function runTracePlotPaths(ctx: ToolContext, args: TracePlotPathsArgs, signal?: AbortSignal): { paths: PlotPath[] } | null {
  const tree = readOutlineFile(ctx.outlineDir);
  const from = findOutlineNode(tree, args.from_node_id);
  const to = findOutlineNode(tree, args.to_node_id);
  if (from === undefined || from.deleted === true || to === undefined || to.deleted === true) return null;
  throwIfAborted(signal);

  const paths: PlotPath[] = [];

  // 1. 树路径（唯一性：严格三层下同分支路径唯一，决策 19）
  const treePath = treeSubPath(tree, args.from_node_id, args.to_node_id);
  if (treePath !== null) {
    paths.push({
      nodes: treePath.nodes,
      description: treePath.backward
        ? `沿大纲树回溯（${args.from_node_id} → ${args.to_node_id}）：共 ${treePath.nodes.length} 个节点`
        : `沿大纲树直接推进（${args.from_node_id} → ${args.to_node_id}）：共 ${treePath.nodes.length} 个节点`,
      risk_factors: collectRiskFactors(tree, treePath.nodes),
    });
  }

  // 2. plot_edge 连线路径（决策 10 画布连线；有向 BFS 沿 source→target，depth=3 上限）
  const edgeResult = listRelations(
    ctx.db,
    { relationType: "plot_edge", sourceId: args.from_node_id },
    3,
    ctx.outlineDir,
  );
  for (const p of edgeResult.paths ?? []) {
    throwIfAborted(signal);
    const last = p.nodes[p.nodes.length - 1];
    if (last === undefined || last.id !== args.to_node_id) continue; // 只取终点 = to 的路径
    paths.push({
      nodes: p.nodes.map((n) => ({ type: n.type, id: n.id, name: n.name })),
      description: `沿剧情连线（plot_edge）推进：共 ${p.nodes.length - 1} 跳`,
      risk_factors: collectRiskFactors(tree, p.nodes),
    });
  }

  return { paths };
}
