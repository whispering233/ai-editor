// 大纲画布连线的展示层口径（契约：docs/ui/DESIGN.md `outline-canvas`「连线 = plot_edge」段）。
//
// 一条 `plot_edge` = 章 → 章的一条边：`edge.id` = **关系 id**（改 / 删都按它走 relation 接口），
// 线上文字 = `metadata.label`（trim 后空串则不画文字），`description` 只在抽屉与关联页出现。
// 两端 id 不在可见章集合内的边走 `canvasPlotEdges` 丢弃：这是脏数据（旧卷 / 已软删章上的关系），
// React Flow 会把端点找不到的边画到画布原点，看着像凭空多出一条线。
import type { CreateRelationBody, RelationSummaryItem } from "./api";

/** 画布上唯一的关系类型（DESIGN.md：下拉只有 plot_edge） */
export const PLOT_EDGE_RELATION_TYPE = "plot_edge";

/** 聚焦某一章时非邻边的透明度（只表达「不是这条线的邻边」，不是设计 token） */
export const PLOT_EDGE_DIM_OPACITY = 0.25;

/** 一条画布连线（React Flow 的 `Edge` 由调用点按此派生，附 label / style） */
export interface CanvasPlotEdge {
  id: string;
  /** 源章 id */
  source: string;
  /** 目标章 id */
  target: string;
  /** 线上短标签（空串 = 不画文字） */
  label: string;
}

/** 关系 metadata → 线上短标签（非字符串值按空串处理；服务端 trim 过，读侧再兜一次） */
export function plotEdgeLabel(metadata: Record<string, unknown> | undefined): string {
  const label = metadata?.label;
  return typeof label === "string" ? label.trim() : "";
}

/** 关系列表 + 可见章集合 → 画布连线（端点不可见 / 自连的脏边丢弃） */
export function canvasPlotEdges(
  relations: readonly RelationSummaryItem[] | null,
  visibleChapterIds: ReadonlySet<string>,
): CanvasPlotEdge[] {
  const edges: CanvasPlotEdge[] = [];
  for (const relation of relations ?? []) {
    if (relation.relationType !== PLOT_EDGE_RELATION_TYPE) continue;
    const { sourceId, targetId } = relation;
    // 自连边服务端也可能存在（接口不拦），画布不认：它只会是一个圈
    if (sourceId === targetId) continue;
    if (!visibleChapterIds.has(sourceId) || !visibleChapterIds.has(targetId)) continue;
    edges.push({ id: relation.id, source: sourceId, target: targetId, label: plotEdgeLabel(relation.metadata) });
  }
  return edges;
}

/** 拖连落点 → 建边 payload（自连 / 落空返回 null = 静默取消；metadata 空，标签在抽屉里补） */
export function plotEdgeCreatePayload(
  source: string | null | undefined,
  target: string | null | undefined,
): CreateRelationBody | null {
  if (source === null || source === undefined || source === "") return null;
  if (target === null || target === undefined || target === "") return null;
  if (source === target) return null;
  return {
    source_type: "outline_node",
    source_id: source,
    target_type: "outline_node",
    target_id: target,
    relation_type: PLOT_EDGE_RELATION_TYPE,
  };
}

/** 聚焦章 id → 以它为任一端点的边 id 集合（`null` = 未聚焦 ⇒ 空集，全部边保持原样） */
export function adjacentPlotEdgeIds(
  edges: readonly CanvasPlotEdge[],
  focusedNodeId: string | null,
): Set<string> {
  const ids = new Set<string>();
  if (focusedNodeId === null) return ids;
  for (const edge of edges) {
    if (edge.source === focusedNodeId || edge.target === focusedNodeId) ids.add(edge.id);
  }
  return ids;
}

/**
 * React Flow 的删除事件 → 待二次确认的边（未知 id 丢弃）。
 * 空数组 = 无事可做（不弹确认框，也不静默删任何东西）。
 */
export function plotEdgeDeleteTargets(
  edges: readonly CanvasPlotEdge[],
  deletedIds: readonly string[],
): CanvasPlotEdge[] {
  const wanted = new Set(deletedIds);
  return edges.filter((edge) => wanted.has(edge.id));
}
