// 建立关联对话框的关系类型下拉口径（卡片 1.6：伏笔锚点仅章）
//
// 服务端收窄（卡 1.3）：relation_type ∈ plants/advances/resolves 且 source_type=outline_node 时，
// 源节点必须是 chapter（非章 → 400 VALIDATION_ERROR）。对话框是唯一还能凑出「卷/场景 → 伏笔」
// 组合的入口（Outline 行右键菜单对所有层级行挂载、OutlineDetail 节点详情亦同；列表模式源端下拉
// 只有实体类型，不产生该组合）——本模块在下拉层排除，与调用方传入的节点层级同向收窄，
// 不留「必定 400」的死胡同（与 lib/current-position.ts 的 isCurrentPositionHost 同一思路）。
import { HOOK_RELATION_TYPES, RELATION_TYPES, RELATION_TYPE_META } from "@whispering233/ai-editor-shared";
import { relationTypeLabel } from "./entity-detail";
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

// ============ 已用自定义类型派生（卡片 8.2） ============

/** 已用关系类型计数条目（`type` = `relation_records.relation_type` 原值） */
export interface RelationTypeUsage {
  type: string;
  count: number;
}

/**
 * 本项目已用的**自定义**关系类型 + 条数（不在 `RELATION_TYPES` 里的即作者自由输入的类型）。
 * 稳定序：条数降序，同条数按类型名码点序（不依赖 locale，测试可锁）。
 * 自定义类型无中心记录（backlog「自定义关系类型改名/合并」），下拉只能从存量关系派生。
 */
export function customRelationTypeUsages(
  relations: readonly { relationType: string }[],
): RelationTypeUsage[] {
  const counts = new Map<string, number>();
  for (const r of relations) {
    if ((RELATION_TYPES as readonly string[]).includes(r.relationType)) continue;
    counts.set(r.relationType, (counts.get(r.relationType) ?? 0) + 1);
  }
  return [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => (a.count !== b.count ? b.count - a.count : a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/** 关系类型选项（`select-free-input` / 过滤下拉共用）：调用方子集在前（中文标签），
 * 已用自定义类型在后（`原名 · 条数`）——**不把子集之外的预定义类型带回来**（保持入口收窄）。 */
export function relationTypeSelectOptions(
  baseTypes: readonly string[],
  customUsages: readonly RelationTypeUsage[],
): { value: string; label: string }[] {
  return [
    ...baseTypes.map((t) => ({ value: t, label: relationTypeLabel(t) })),
    ...customUsages.map((u) => ({ value: u.type, label: `${u.type} · ${u.count}` })),
  ];
}
