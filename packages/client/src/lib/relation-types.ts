// 建立关联对话框的关系类型下拉与提交 guard 口径
//
// 端点适用性（哪些类型可用于「源 → 目标」）= shared `RELATION_TYPE_META[*].endpoints` 的成对声明，
// 谓词单一实现 = shared `relationTypeAllowedFor`（本模块只派生，不手抄类型清单）。
// 矩阵之外保留两条客户端更严的口径：
// ① `group === "mount"` 不进通用对话框：挂载（timepoint → event 1:n，G2）由时间轴 UI 专管
//    （组尾新建 POST /relation 固定方向、跨组拖拽 move_to 复合端点），自定义 occurs_at 不在此暴露；
// ② 源为大纲节点但层级未知（`nodeType` 缺失）时排除伏笔三类：shared 谓词对缺失 nodeType 是**通配**，
//    而服务端「伏笔源端仅章」必定 400——下拉与提交 guard 都按更严的一侧收口，不留死胡同。
import {
  ENTITY_TYPE_LABELS,
  HOOK_RELATION_TYPES,
  OUTLINE_NODE_TYPE_LABELS,
  RELATION_TYPES,
  RELATION_TYPE_META,
  relationTypeAllowedFor,
  type RelationEndpointRef,
} from "@whispering233/ai-editor-shared";
import { relationTypeLabel } from "./entity-detail";

/** 端点入参（结构同 shared 谓词入参；`nodeType` 仅大纲节点侧有意义） */
export type RelationTypeSource = RelationEndpointRef;

/** 伏笔三类（`HOOK_RELATION_TYPES` 的字面量联合转字符串集合，供 `includes` 用） */
const HOOK_TYPES: readonly string[] = HOOK_RELATION_TYPES;

/** 层级未知的节点源是否因此被 fail-closed 排除（见文件头 ②） */
function unknownLevelHook(type: string, from: RelationEndpointRef): boolean {
  return from.type === "outline_node" && from.nodeType === undefined && HOOK_TYPES.includes(type);
}

/**
 * 关系类型下拉选项（按「源端点 + 目标端点」收窄）：
 * `from === null`（调用方尚未定源）或 `to` 缺省时只保留基集，不由矩阵收窄。
 */
export function dialogRelationTypeOptions(
  from: RelationTypeSource | null,
  to?: RelationEndpointRef,
): string[] {
  const base = RELATION_TYPES.filter((t) => RELATION_TYPE_META[t].group !== "mount");
  const narrowed = from?.type === "outline_node" && from.nodeType === undefined
    ? base.filter((t) => !HOOK_TYPES.includes(t))
    : base;
  if (from === null || to === undefined) return narrowed;
  return narrowed.filter((t) => relationTypeAllowedFor(t, from, to));
}

/** 端点中文标签（错误文案用）：实体取 shared 实体标签，节点层级取卷/章/场景 */
function endpointLabel(endpoint: RelationEndpointRef): string {
  if (endpoint.type !== "outline_node") return ENTITY_TYPE_LABELS[endpoint.type];
  if (endpoint.nodeType === undefined) return "大纲节点";
  return OUTLINE_NODE_TYPE_LABELS[endpoint.nodeType as keyof typeof OUTLINE_NODE_TYPE_LABELS] ?? "大纲节点";
}

/**
 * 提交前 guard（类型输入是自由文本 AutoComplete，下拉只是建议）：非法组合 → 中文文案，合法 / 自定义类型 → null。
 * 与 `dialogRelationTypeOptions` 同口径：矩阵谓词 + fail-closed（层级未知的节点源不进伏笔）。
 */
export function relationEndpointError(
  type: string,
  from: RelationEndpointRef,
  to: RelationEndpointRef,
): string | null {
  if (!unknownLevelHook(type, from) && relationTypeAllowedFor(type, from, to)) return null;
  return `「${relationTypeLabel(type)}」不能用于 ${endpointLabel(from)} → ${endpointLabel(to)}`;
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

/** 关系类型选项（过滤下拉专用：`Select` 用 option label 展示，值 = 原始类型）：调用方子集在前（中文标签），
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

// ============ 自由输入控件的展示/取值映射（卡片 8.2 像素验证轮） ============
//
// `AutoComplete` 是 combobox：**输入框显示的是 option 的 `value`**（不是 label）——若 value 用原始 key，
// 中文界面里就会出现「ally」这种内部标识（既有 `Select` 路径用 label 展示，无此问题）。
// 因此自由输入控件单独一组选项：预定义的 `value` = 中文标签，自定义的 `value` = 原名（label 带条数只进列表）。
// 提交前用 `resolveRelationTypeInput` 反解回 `relation_records.relation_type` 的真实取值。

/** 自由输入控件选项：预定义 → value = 中文标签；自定义 → value = 原名（列表 label 带 ` · N`） */
export function relationTypeInputOptions(
  baseTypes: readonly string[],
  customUsages: readonly RelationTypeUsage[],
): { value: string; label: string }[] {
  return [
    ...baseTypes.map((t) => ({ value: relationTypeLabel(t), label: relationTypeLabel(t) })),
    ...customUsages.map((u) => ({ value: u.type, label: `${u.type} · ${u.count}` })),
  ];
}

/**
 * 自由输入文本 → 落库取值（三层判定，顺序要紧）：
 * 1. 文本本身就是预定义 key（作者直接敲 `ally`——幂等，不新造同名自定义类型）；
 * 2. 文本命中某个预定义**中文标签**（自由输入控件里预定义的展示形态）→ 该 key；
 * 3. 其余 → 原样（自定义类型，语法校验交给 shared `relationTypeSyntaxError`）。
 */
export function resolveRelationTypeInput(text: string): string {
  const trimmed = text.trim();
  if ((RELATION_TYPES as readonly string[]).includes(trimmed)) return trimmed;
  const byLabel = RELATION_TYPES.find((t) => relationTypeLabel(t) === trimmed);
  return byLabel ?? trimmed;
}
