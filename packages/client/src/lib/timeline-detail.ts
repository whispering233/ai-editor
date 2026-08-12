// 时间轴详情页辅助纯函数（C4，决策 26）
// 契约：doc/ui/pages/timeline.md「详情页（#/timeline/:id）」（occurs_in 关联管理）、
//   endpoints.md「关系管理」（POST /relation event → outline_node，occurs_in，决策 26）
// 风格：与 lib/hook-panel.ts 同构——buildXxxRelationBody 请求体构造 + 关系过滤。
// 事件表单共享函数（EventDetailForm / eventFormFromDetail / buildEventDetailPatch）已迁入
// lib/timeline.ts（C3，与列表页编辑对话框共用单一实现）——本文件只保留详情页专属的
// occurs_in 关联管理；TimelineDetail.tsx 从两个 lib 分别引入（C4 单向依赖 C3）。
import type { CreateRelationBody, RelationSummaryItem } from "./api";

/** occurs_in 关系类型（event → outline_node 锚定，多对多，决策 26） */
export const OCCURS_IN = "occurs_in";

/**
 * 从详情 relations 提取事件锚定节点关系：occurs_in 且 sourceId === eventId
 * （事件为 source 端——决策 26 方向约定；与 C3 列表页「N 节点」计数同口径）。
 * 其余方向/类型（如其他事件为 source）不参与展示。
 */
export function occursInRelations(
  relations: readonly RelationSummaryItem[],
  eventId: string,
): RelationSummaryItem[] {
  return relations.filter((r) => r.relationType === OCCURS_IN && r.sourceId === eventId);
}

/** occurs_in 关系请求体（event → outline_node，endpoints.md L368；与 buildPlantRelationBody 同构） */
export function buildOccursRelationBody(eventId: string, nodeId: string): CreateRelationBody {
  return {
    source_type: "event",
    source_id: eventId,
    target_type: "outline_node",
    target_id: nodeId,
    relation_type: OCCURS_IN,
  };
}
