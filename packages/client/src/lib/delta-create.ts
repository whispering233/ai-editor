// 变更记录创建表单辅助纯函数与配置（S12.3）
// 契约：endpoints.md L395-434（POST /delta per-op 必填语义：set→to、update→from+to、add/remove→value）、
//   决策 9 修订（update 的 from 由客户端自动取目标当前 data 值——作者无需手填；data 后续被改 →
//   compute 时跳过 + conflicts 标注，机制兜底）、决策 23（大纲节点字段集，载体 node.data）、
//   shared ENTITY_DATA_SCHEMAS（字段名编译期断言：client 只消费类型不打包 zod，schema 变更即编译报错防漂移）
import type { DeltaChange, DeltaOp, EntityType } from "@ai-editor/shared";
import { ENTITY_TYPES } from "@ai-editor/shared";
// 类型-only 导入 schema 常量（编译期擦除，不打包 zod；用于断言本地字段清单 = shared schema keys）
import type { ENTITY_DATA_SCHEMAS } from "@ai-editor/shared/schemas";
import type { OutlineNodeType } from "./api";
import { detailFieldsForType } from "./entity-detail";
import { detailFieldsForNodeType } from "./outline-detail";
import { targetTypeLabel } from "./delta";

// ============ 目标类型选项（复用 lib/delta targetTypeLabel，不自行定义标签） ============

/** 变更目标类型下拉（四类实体 + 大纲节点） */
export const DELTA_TARGET_TYPE_OPTIONS = [
  ...ENTITY_TYPES.map((t) => ({ value: t, label: targetTypeLabel(t) })),
  { value: "outline_node", label: targetTypeLabel("outline_node") },
] as const;

// ============ 字段清单（编译期断言 = shared ENTITY_DATA_SCHEMAS 的 keys） ============

type EntityDataKey<T extends keyof typeof ENTITY_DATA_SCHEMAS> = keyof typeof ENTITY_DATA_SCHEMAS[T]["shape"];

/** 各实体类型 data 字段名（全量含 custom_fields；断言见下——shared schema 增删字段会编译报错） */
const ENTITY_DATA_KEYS = {
  character: [
    "role",
    "gender",
    "age",
    "personality",
    "motivation",
    "abilities",
    "status",
    "custom_fields",
  ] as const satisfies readonly EntityDataKey<"character">[],
  setting: ["category", "parent_id", "description", "rules", "custom_fields"] as const satisfies readonly EntityDataKey<"setting">[],
  location: ["type", "parent_id", "description", "custom_fields"] as const satisfies readonly EntityDataKey<"location">[],
  hook: [
    "status",
    "category",
    "expected_payoff",
    "payoff_timing",
    "half_life",
    "is_core",
    "notes",
    "expected_resolve_node_id",
  ] as const satisfies readonly EntityDataKey<"hook">[],
} as const;

/** 实体字段中文标签（复用 lib/entity-detail detailFieldsForType 的 label 配置；未收录回退字段名原文） */
const ENTITY_FIELD_LABELS: Record<string, Record<string, string>> = {
  character: labelsOf("character"),
  setting: labelsOf("setting"),
  location: labelsOf("location"),
  hook: labelsOf("hook"),
};

function labelsOf(t: EntityType): Record<string, string> {
  return Object.fromEntries(detailFieldsForType(t).map((f) => [f.key, f.label]));
}

// ============ 数组字段 / 数字字段（op 推断与值解析依据） ============

/** 数组字段（op 推断：默认 add/remove；余下标量默认 set/update）——字段名须在对应清单内（单测断言） */
const ARRAY_FIELDS: Record<string, readonly string[]> = {
  character: ["personality", "abilities"],
  setting: ["rules"],
  scene: ["conflict_levels"],
};

/** 数字字段（值输入解析为 number；余下保持字符串——服务端 delta value 类型 string|number） */
const NUMERIC_FIELDS: Record<string, readonly string[]> = {
  character: ["age"],
  hook: ["half_life"],
};

/** 字段是否数组（决定 op 选项）；scope = 实体类型或大纲层级（scene） */
export function isArrayField(scope: string, key: string): boolean {
  return (ARRAY_FIELDS[scope] ?? []).includes(key);
}

/** 字段是否数字（值提交时解析 Number） */
export function isNumericField(scope: string, key: string): boolean {
  return (NUMERIC_FIELDS[scope] ?? []).includes(key);
}

// ============ 字段下拉选项 ============

/** 字段下拉项（delta 表单「字段」选择器） */
export interface DeltaFieldOption {
  key: string;
  label: string;
  /** 数组字段（op 推断依据） */
  array: boolean;
}

/** 实体目标字段选项：ENTITY_DATA_KEYS 全量（除 custom_fields——record 无法用标量值表达）→ label + array 标记 */
export function entityDeltaFieldOptions(type: string): DeltaFieldOption[] {
  const keys = (ENTITY_DATA_KEYS as Record<string, readonly string[]>)[type] ?? [];
  return keys
    .filter((k) => k !== "custom_fields")
    .map((k) => ({ key: k, label: ENTITY_FIELD_LABELS[type]?.[k] ?? k, array: isArrayField(type, k) }));
}

/**
 * 大纲节点目标字段选项（决策 23 字段集，复用 lib/outline-detail detailFieldsForNodeType）：
 * 目标节点类型已知 → 该层级字段；未知（节点不在树中/已删）→ 三层字段集并集兜底
 */
export function nodeDeltaFieldOptions(nodeType: OutlineNodeType | null): DeltaFieldOption[] {
  const configs = nodeType === null ? [] : detailFieldsForNodeType(nodeType);
  const list = configs.length > 0 ? configs : unionNodeFieldConfigs();
  return list.map((f) => ({ key: f.key, label: f.label, array: isArrayField("scene", f.key) }));
}

/** 决策 23 三层字段集并集（scene → chapter → volume 顺序；label 冲突时后写覆盖） */
function unionNodeFieldConfigs() {
  const union: Array<{ key: string; label: string }> = [];
  for (const t of ["scene", "chapter", "volume"] as const) {
    for (const f of detailFieldsForNodeType(t)) {
      const i = union.findIndex((u) => u.key === f.key);
      if (i >= 0) union[i] = f;
      else union.push(f);
    }
  }
  return union;
}

// ============ op 推断与 changes 构造 ============

/**
 * 当前值可否作为 op=update 的 from（服务端 schema：string | number | null）：
 * string/number → 原值；null → null（字段存在但为空，「旧值：空」）；
 * undefined（字段缺失）/boolean/数组/对象 → 不可表达（update 无旧值可写，引导改「设为」）
 */
export function resolvableFromValue(v: unknown): string | number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  return undefined;
}

/** op 选项与默认值：数组 → [add, remove] 默认 add；标量 → 当前值可作 from 时 [update, set] 默认 update，
 *  否则仅 [set]（update 无旧值可写，避免提交被 400 拒绝） */
export function inferOpOptions(args: {
  array: boolean;
  currentValue: unknown;
}): { options: DeltaOp[]; default: DeltaOp } {
  if (args.array) return { options: ["add", "remove"], default: "add" };
  return resolvableFromValue(args.currentValue) !== undefined
    ? { options: ["update", "set"], default: "update" }
    : { options: ["set"], default: "set" };
}

/** changes 构造参数（S12.3 表单提交路径） */
export interface BuildDeltaChangeArgs {
  field: string;
  op: DeltaOp;
  /** 值输入原文（trim 后非空校验；数字字段解析 Number，NaN 回退字符串） */
  rawValue: string;
  numeric: boolean;
  /** op=update 用：目标当前值（实体详情 data / 节点 data；自动取 from，决策 9 修订） */
  currentValue: unknown;
}

export type BuildDeltaChangeResult = { change: DeltaChange } | { error: string };

/** 构造单条 change（per-op 必填语义对齐 endpoints.md；update 自动填 from——不可解析则报错引导改「设为」） */
export function buildDeltaChange(args: BuildDeltaChangeArgs): BuildDeltaChangeResult {
  const v = args.rawValue.trim();
  if (v === "") return { error: "请填写值" };
  const num = Number(v);
  const parsed: string | number = args.numeric && !Number.isNaN(num) ? num : v;
  switch (args.op) {
    case "add":
      return { change: { field: args.field, op: "add", value: parsed } };
    case "remove":
      return { change: { field: args.field, op: "remove", value: parsed } };
    case "set":
      return { change: { field: args.field, op: "set", to: parsed } };
    case "update": {
      const from = resolvableFromValue(args.currentValue);
      if (from === undefined) {
        return { error: "无法确定旧值（当前数据无此字段或类型不可表达），请改用「设为」" };
      }
      return { change: { field: args.field, op: "update", from, to: parsed } };
    }
  }
}
