// 时间轴详情页辅助纯函数（C4，决策 26；G2.3 修订：occurs_at 挂载关系）
// 契约：doc/ui/pages/timeline.md「详情页（#/timeline/:id）」（occurs_in 关联管理 + G2 挂载时间点选择器）、
//   endpoints.md「关系管理」（POST /relation event → outline_node，occurs_in，决策 26；
//   occurs_at：timepoint → event 1:n 挂载，G2）
// 风格：与 lib/hook-panel.ts 同构——buildXxxRelationBody 请求体构造 + 关系过滤。
// 事件表单共享函数（EventDetailForm / eventFormFromDetail / buildEventDetailPatch）已迁入
// lib/timeline.ts（C3，与列表页编辑对话框共用单一实现）——本文件只保留详情页专属的
// occurs_in 关联管理 + occurs_at 挂载管理；TimelineDetail.tsx 从两个 lib 分别引入（C4 单向依赖 C3）。
import type { CreateRelationBody, RelationSummaryItem } from "./api";

/** occurs_in 关系类型（event → outline_node 锚定，多对多，决策 26） */
export const OCCURS_IN = "occurs_in";

/** occurs_at 关系类型（timepoint → event 挂载，1:n，G2） */
export const OCCURS_AT = "occurs_at";

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

/** occurs_in 关系请求体（event → outline_node，endpoints.md 关系管理节；与 buildPlantRelationBody 同构） */
export function buildOccursRelationBody(eventId: string, nodeId: string): CreateRelationBody {
  return {
    source_type: "event",
    source_id: eventId,
    target_type: "outline_node",
    target_id: nodeId,
    relation_type: OCCURS_IN,
  };
}

/**
 * 事件的当前挂载时间点 id（G2，详情页挂载选择器）：
 * 从详情 relations 提取 occurs_at 且事件为 target 端（方向约定 timepoint → event，
 * sourceId = 时间点 id）；无挂载 → null（事件归「未挂载」兜底区）。
 * 防御：sourceType 也须为 timepoint（occurs_at 双语义——地点出现于由大纲节点承载，
 * 与事件无关；targetId 已限事件，此处双保险）。
 */
export function mountedTimepointId(
  relations: readonly RelationSummaryItem[],
  eventId: string,
): string | null {
  const mounted = relations.find(
    (r) => r.relationType === OCCURS_AT && r.sourceType === "timepoint" && r.targetId === eventId,
  );
  return mounted === undefined ? null : mounted.sourceId;
}

/** occurs_at 挂载请求体（timepoint → event，G2；组内「+ 在此时间点新建事件」挂载用） */
export function buildOccursAtRelationBody(timepointId: string, eventId: string): CreateRelationBody {
  return {
    source_type: "timepoint",
    source_id: timepointId,
    target_type: "event",
    target_id: eventId,
    relation_type: OCCURS_AT,
  };
}
