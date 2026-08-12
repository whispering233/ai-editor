// 实体 / 关系 / Delta 数据类型（API 形态 camelCase + 存储形态 snake_case 两套）
// 契约来源：doc/api/endpoints.md、doc/database/schema.md、doc/database/hooks.md
// 命名约定（endpoints.md「通用约定」）：请求体/查询参数 snake_case，响应体 camelCase；
// 嵌套 data 对象内部字段原样透传（snake_case，如 expected_payoff）。

// ============ 实体 ============

/** 实体类型（entities 表 type 列，schema.md；event 为时间轴事件，决策 26） */
export type EntityType = "character" | "setting" | "location" | "hook" | "event";

/**
 * 实体（API 响应形态，camelCase；对应 GET /api/v1/entity/:type/:id 详情）
 * data 为各类型专属字段（Record 透传，snake_case 原样），结构见 schema.md 与 hooks.md
 */
export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  data: Record<string, unknown>;
  createdAt: string; // ISO 8601，应用层写入
  updatedAt: string; // ISO 8601（提案快照比对，决策 14）
  /** 软删标记（决策 12）；常规查询默认过滤，回收站 API 返回 */
  deletedAt?: string | null;
}

/**
 * 实体列表摘要（GET /api/v1/entity/:type 列表项，endpoints.md）
 * summary 为从 data 提取的关键摘要字段（如 character → role/status、hook → status/payoff_timing）
 */
export interface EntitySummary {
  id: string;
  type: EntityType;
  name: string;
  summary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** entities 表行（存储形态 snake_case，schema.md） */
export interface EntityRow {
  id: string;
  type: EntityType;
  name: string;
  /** JSON 列解析后的对象 */
  data: Record<string, unknown>;
  created_at: string; // ISO 8601，应用层写入
  updated_at: string; // ISO 8601（提案快照比对，决策 14）
  deleted_at: string | null; // 软删标记（决策 12），NULL = 未删除
}

// ============ 关系 ============

/** 关系（API 响应形态，GET /api/v1/relation depth=1，endpoints.md） */
export interface RelationRecord {
  id: string;
  sourceType: string;
  sourceId: string;
  /** 联表查询填充（endpoints.md） */
  sourceName?: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  relationType: string; // 预定义类型见 schema.md（belongs_to/owns/plants/plot_edge 等）
  metadata?: Record<string, unknown>; // JSON 扩展元数据
  createdAt: string;
}

/** 路径节点（depth>=2 时的 paths 结构，endpoints.md） */
export interface RelationPathNode {
  type: string;
  id: string;
  name: string;
}

/** 路径边（depth>=2 时的 paths 结构，endpoints.md） */
export interface RelationPathEdge {
  from: string;
  to: string;
  relationType: string;
}

/** 一条 k 跳路径（depth>=2 时的 paths 结构，endpoints.md） */
export interface RelationPath {
  nodes: RelationPathNode[];
  edges: RelationPathEdge[];
}

/** 关系查询响应（GET /api/v1/relation，endpoints.md） */
export interface RelationQueryResult {
  relations: RelationRecord[];
  /** depth>=2 时追加路径信息 */
  paths?: RelationPath[];
}

/** relation_records 表行（存储形态 snake_case，schema.md） */
export interface RelationRow {
  id: string;
  /** 端点类型：实体 'character'|'setting'|'location'|'hook'，大纲节点 'outline_node' */
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relation_type: string;
  /** JSON 扩展元数据，NULL 表示无 */
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string; // 提案快照比对（决策 14）；软删/还原亦更新（决策 12 修订）
  /** 级联软删标记（决策 12）：仅实体/节点级联删除时写入；手动删关系 = 物理删 */
  deleted_at: string | null;
}

// ============ Delta ============

/** 变更操作类型（POST /api/v1/delta changes[].op，endpoints.md） */
export type DeltaOp = "set" | "update" | "add" | "remove";

/**
 * 单条属性变更（POST /api/v1/delta Req changes 项，endpoints.md）
 * op 语义（2026-08 修订）：set=直接替换；update=旧值→新值（写入端不校验 from，
 *   冲突在 computeState 时以跳过+conflicts 呈现，决策 9 修订）；add=按 value 向数组追加；
 *   remove=按值匹配从数组移除（不存在的值静默忽略）
 */
export interface DeltaChange {
  field: string;
  op: DeltaOp;
  /** 旧值（op=update 时必填） */
  from?: string | number | null;
  /** 新值（op=set/update 时必填；add/remove 用 value） */
  to?: string | number | null;
  /** 值（op=add/remove 时使用） */
  value?: string | number;
}

/** Delta 记录（API 响应形态，endpoints.md） */
export interface DeltaRecord {
  id: string;
  /** 触发变更的大纲节点 id */
  nodeId: string;
  targetType: string;
  targetId: string;
  /** 联表填充 */
  targetName?: string;
  changes: DeltaChange[];
  description: string; // 人类可读描述
  /** 同一节点内多个 Delta 的排序（全局单调递增，服务端生成） */
  order: number;
  createdAt: string;
}

/** delta_records 表行（存储形态 snake_case，schema.md） */
export interface DeltaRow {
  id: string;
  node_id: string;
  target_type: string;
  target_id: string;
  /** JSON 列解析后的数组 */
  changes: DeltaChange[];
  description: string;
  /** 同一节点内多个 Delta 的排序（全局单调递增，服务端生成） */
  order: number;
  created_at: string;
  updated_at: string; // 提案快照比对（决策 14）
  /** 级联软删标记（决策 12 修订）：触发节点或目标实体任一软删即不可见 */
  deleted_at: string | null;
}

// ============ 状态计算（computeState） ============

/** 被跳过的单个 change（决策 9 修订：op=update 且当前值 ≠ from） */
export interface AppliedDeltaSkippedChange {
  /** 在 changes 数组中的下标 */
  index: number;
  field: string;
  /** delta 中声明的 from */
  expected: unknown;
  /** 应用时的实际值 */
  actual: unknown;
}

/** 参与状态计算的一个 Delta（computeState 响应项，endpoints.md） */
export interface AppliedDelta {
  nodeId: string;
  description: string;
  changes: unknown[];
  /** 该 delta 中被跳过的 change（决策 9 修订） */
  skipped?: AppliedDeltaSkippedChange[];
}

/** 汇总的冲突字段（2026-08 修订，替代原 409 DELTA_CONFLICT） */
export interface DeltaConflict {
  deltaId: string;
  field: string;
  /** delta 中 from */
  expected: unknown;
  /** 应用时实际值 */
  actual: unknown;
}

/** 状态计算结果（POST /api/v1/delta/compute 响应，endpoints.md） */
export interface ComputeStateResult {
  targetType: string;
  targetId: string;
  atNodeId: string;
  /** 初始 data + 树路径上所有 Delta 累积后的结果（决策 9：只沿大纲树父链累积） */
  state: Record<string, unknown>;
  appliedDeltas: AppliedDelta[];
  conflicts: DeltaConflict[];
}
