// 建立关联对话框的关系类型下拉口径（卡片 1.6：伏笔锚点仅章）
//
// 服务端收窄（卡 1.3）：relation_type ∈ plants/advances/resolves 且 source_type=outline_node 时，
// 源节点必须是 chapter（非章 → 400 VALIDATION_ERROR）。对话框是唯一还能凑出「卷/场景 → 伏笔」
// 组合的入口（Outline 行右键菜单对所有层级行挂载、OutlineDetail 节点详情亦同；列表模式源端下拉
// 只有实体类型，不产生该组合）——本模块在下拉层排除，与调用方传入的节点层级同向收窄，
// 不留「必定 400」的死胡同（与 lib/current-position.ts 的 isCurrentPositionHost 同一思路）。
import { HOOK_RELATION_TYPES, RELATION_TYPES, RELATION_TYPE_META } from "@whispering233/ai-editor-shared";
import type { OutlineNodeType } from "./api";

/**
 * 对话框关系类型下拉基集（oracle P2-2：occurs_at 方向白名单）：
 * **排除 `group === "mount"`**（现仅 `occurs_at`）——挂载（timepoint → event 1:n，G2）由时间轴 UI 专管
 * （组尾新建 POST /relation 固定方向、跨组拖拽 move_to 复合端点），对话框不暴露自定义 occurs_at 创建，
 * UI 层天然限制「仅 timepoint → event」方向（目标端下拉亦无 event 可选，双保险）。
 */
const DIALOG_RELATION_TYPES: readonly string[] = RELATION_TYPES.filter(
  (t) => RELATION_TYPE_META[t].group !== "mount",
);

/** 源端入参形状（结构类型：RelationSource 的可见子集；此处声明避免 lib → components 反向依赖） */
export interface RelationTypeSource {
  type: string;
  /** 源端为大纲节点时的节点层级（调用点显式传入，不靠 store 反查） */
  nodeType?: OutlineNodeType;
}

/** 源端点是否可承载伏笔锚点——仅**章**节点（卡 1.3 服务端同口径）；实体源无此限制 */
function hookAnchorAllowed(source: RelationTypeSource | null): boolean {
  if (source === null || source.type !== "outline_node") return true;
  // nodeType 缺失按非章处理（fail-closed：宁可少一个选项，也不留必定 400 的入口）
  return source.nodeType === "chapter";
}

/** 关系类型下拉选项（按源端层级过滤）：非章大纲节点源排除 plants/advances/resolves */
export function dialogRelationTypeOptions(source: RelationTypeSource | null): string[] {
  if (hookAnchorAllowed(source)) return [...DIALOG_RELATION_TYPES];
  const excludedHookTypes = new Set<string>(HOOK_RELATION_TYPES);
  return DIALOG_RELATION_TYPES.filter((t) => !excludedHookTypes.has(t));
}
