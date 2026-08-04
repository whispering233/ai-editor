// Delta 展示辅助纯函数（S5.4；契约：shared types/entity.ts DeltaChange/DeltaRecord/ComputeStateResult +
//   endpoints.md「Delta 变更追踪」——op 语义 set/update/add/remove，2026-08 修订）
// 用途：大纲节点变更记录面板与实体详情状态预览共用；保持薄封装，UI 组件只做编排
import type { DeltaChange, DeltaOp } from "@whispering233/ai-editor-shared";

/** op → 中文标签（changes 摘要 chip 前缀） */
export const DELTA_OP_LABEL: Record<DeltaOp, string> = {
  set: "设为",
  update: "更新",
  add: "追加",
  remove: "移除",
};

/** Delta 目标类型 → 中文徽标（含大纲节点端点；未收录原样显示） */
const TARGET_TYPE_LABEL: Record<string, string> = {
  character: "人物",
  setting: "设定",
  location: "地点",
  hook: "伏笔",
  outline_node: "大纲节点",
};

export function targetTypeLabel(t: string): string {
  return TARGET_TYPE_LABEL[t] ?? t;
}

/** 值 → 展示串（null/undefined → 「空」；对象/数组 JSON 化——from/to/value 均为 JSON 类型） */
export function formatDeltaValue(v: unknown): string {
  if (v === null || v === undefined) return "空";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * 单条 change 的紧凑摘要（op/field/from→to 语义，endpoints.md）：
 * set → `field = to`；update → `field from → to`；add → `field +value`；remove → `field -value`
 */
export function describeChange(c: DeltaChange): string {
  switch (c.op) {
    case "set":
      return `${c.field} = ${formatDeltaValue(c.to)}`;
    case "update":
      return `${c.field} ${formatDeltaValue(c.from)} → ${formatDeltaValue(c.to)}`;
    case "add":
      return `${c.field} +${formatDeltaValue(c.value ?? c.to)}`;
    case "remove":
      return `${c.field} -${formatDeltaValue(c.value ?? c.to)}`;
  }
}

/** 状态差异条目（compute 结果 vs 当前 data；from/to 为 undefined 表示该侧不存在） */
export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * 比较 compute 累积 state 与实体当前 data，返回值有变化的字段（有序）：
 * 比较基准 = JSON 序列化（undefined/null 归一）；计算态新增字段 from=undefined（展示「（无）」）、
 * 当前态独有字段 to=undefined（展示「（已移除）」）
 * 注：JSON.stringify 比较对**键序不同**的等价对象会误报差异（如 {a:1,b:2} vs {b:2,a:1}）；
 *   当前数据流两侧均源自服务端同一份 data 的深拷贝（set 类变更整体替换），键序一致，不会触发；
 *   若未来引入手动拼装对象的变更来源，需改为递归深比较
 */
export function diffStateFields(
  original: Record<string, unknown>,
  computed: Record<string, unknown>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  for (const key of new Set([...Object.keys(original), ...Object.keys(computed)])) {
    const a = original[key] ?? null;
    const b = computed[key] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ field: key, from: original[key], to: computed[key] });
    }
  }
  return diffs;
}
