// 伏笔面板辅助纯函数与复合写编排（S9.1）
// MVP 简化（backlog #13）：本模块不消费 _health 字段、不计算章节序——只处理基础字段与生命周期
import type {
  DeltaChange,
  EntitySummary,
  OutlineTree,
  ProjectConfig,
} from "@whispering233/ai-editor-shared";
import {
  ApiError,
  createDelta,
  createRelation,
  updateEntity,
  type CreateRelationBody,
  type RelationSummaryItem,
} from "./api";
import { chapterNodeExists, chapterNodeOptions } from "./outline-tree";

// ============ 状态分组（信息层级） ============

export type HookGroupKey = "active" | "resolved" | "abandoned";

/**
 * 状态 → 分组：planted/progressing → 活跃；resolved → 已回收；abandoned → 已废弃。
 * 缺失/未知状态归活跃（data.status 缺失视为 planted——创建即埋设）
 */
export function hookGroupOf(status: unknown): HookGroupKey {
  if (status === "resolved") return "resolved";
  if (status === "abandoned") return "abandoned";
  return "active";
}

/** 伏笔池分组结果（三组 + 计数由数组长度得出） */
export interface HookGroups {
  active: EntitySummary[];
  resolved: EntitySummary[];
  abandoned: EntitySummary[];
}

/** 列表摘要按状态分组（「按 summary.status 分组」） */
export function groupHooksByStatus(items: readonly EntitySummary[]): HookGroups {
  const groups: HookGroups = { active: [], resolved: [], abandoned: [] };
  for (const item of items) groups[hookGroupOf(item.summary.status)].push(item);
  return groups;
}

// ============ 关系解析（depends_on：source 依赖 target——「B 依赖 A 先解开」） ============

/** 按关系类型过滤（详情 relations 分区：plants/advances/resolves/depends_on/involves） */
export function relationsOfType(
  relations: readonly RelationSummaryItem[],
  relationType: string,
): RelationSummaryItem[] {
  return relations.filter((r) => r.relationType === relationType);
}

/**
 * 本伏笔「依赖的伏笔」名字（depends_on 中 sourceId === hookId → target 名；targetName 缺省用 id）。
 * 行内「依赖: xxx」展示（行主信息）
 */
export function dependencyNames(
  relations: readonly RelationSummaryItem[],
  hookId: string,
): string[] {
  return relationsOfType(relations, "depends_on")
    .filter((r) => r.sourceId === hookId)
    .map((r) => r.targetName ?? r.targetId);
}

/** 依赖本伏笔的伏笔名（depends_on 中 targetId === hookId；回收确认面板「有 N 个伏笔依赖此伏笔」） */
export function dependentNames(
  relations: readonly RelationSummaryItem[],
  hookId: string,
): string[] {
  return relationsOfType(relations, "depends_on")
    .filter((r) => r.targetId === hookId)
    .map((r) => r.sourceName ?? r.sourceId);
}

/** 依赖本伏笔的伏笔数（回收确认面板提示文案计数） */
export function dependentsCount(relations: readonly RelationSummaryItem[], hookId: string): number {
  return dependentNames(relations, hookId).length;
}

/** involves 关系的另一端名称（hook → 人物/设定/地点；任一端为本伏笔取另一端联表名，缺省 id） */
export function involvesNames(relations: readonly RelationSummaryItem[], hookId: string): string[] {
  return relationsOfType(relations, "involves").map((r) =>
    r.sourceId === hookId ? (r.targetName ?? r.targetId) : (r.sourceName ?? r.sourceId),
  );
}

// ============ 依赖链递归展开（行内「依赖: …」点击展开） ============

/** 依赖链展开节点（depth 0 = 起点伏笔自身） */
export interface DepChainNode {
  hookId: string;
  name: string;
  depth: number;
}

/** 依赖链最大展开深度（含起点；防深层链无限展开） */
export const MAX_CHAIN_DEPTH = 3;

/**
 * 递归展开「依赖链」（关键交互：行内「依赖: 玉佩来历」可点击展开递归链）：
 * - 边语义：source 依赖 target；从起点沿 depends_on 的 target 逐层下行
 * - 深度限制 maxDepth（默认 3 层含起点）——更深层级以截断呈现
 * - 环守卫：visited 跳过已访问伏笔（A↔B 互依赖等环状脏数据不陷入死循环）
 * - 名称兜底：names 映射缺失 → 显示 id（关系 targetName 可能缺省）
 * 纯函数：depsOf/names 由页面从各伏笔详情 fetch 累积后传入（调用方负责取数）
 */
export function expandDependencyChain(args: {
  startHookId: string;
 /** 每个伏笔的 depends_on 关系集（key = 伏笔 id；页面按需 fetch 详情累积） */
  depsOf: ReadonlyMap<string, readonly RelationSummaryItem[]>;
 /** 伏笔 id → 名称（详情 name / 关系 targetName 累积） */
  names: ReadonlyMap<string, string>;
  maxDepth?: number;
}): DepChainNode[] {
  const maxDepth = args.maxDepth ?? MAX_CHAIN_DEPTH;
  const result: DepChainNode[] = [];
  const visited = new Set<string>([args.startHookId]);
  const queue: Array<{ hookId: string; depth: number }> = [{ hookId: args.startHookId, depth: 0 }];
  while (queue.length > 0) {
    const { hookId, depth } = queue.shift()!;
    result.push({ hookId, name: args.names.get(hookId) ?? hookId, depth });
    if (depth >= maxDepth) continue;
    for (const r of args.depsOf.get(hookId) ?? []) {
      if (r.relationType !== "depends_on" || r.sourceId !== hookId) continue;
      if (visited.has(r.targetId)) continue;
      visited.add(r.targetId);
      queue.push({ hookId: r.targetId, depth: depth + 1 });
    }
  }
  return result;
}

// ============ 章节点选项与废弃锚点（锚点仅章：executor anchorNodeForAbandon 同款语义，tools/executor/hook.ts） ============

/**
 * 树末章：先序遍历最后一个未软删 `chapter`（「当前写作进度末端」，与 executor lastChapterNodeId 同语义）；
 * 无章 → null（面板禁用提交并内联提示）。
 */
export function lastChapterNode(tree: OutlineTree | null): string | null {
  const options = chapterNodeOptions(tree);
  return options.length === 0 ? null : options[options.length - 1].id;
}

/**
 * 废弃 Delta 锚定节点：current_position **有效（存在且未软删且为章）**优先，否则退化树末章；
 * 大纲无章 → null（面板禁用提交并内联提示——无锚点不可记录，同 executor 抛错语义）。
 * 卡片 1.3：锚点仅章——current_position 为存量场景/卷值时不再直接用作锚点（否则写入必 400）。
 */
export function anchorNodeForAbandon(
  config: ProjectConfig | null,
  tree: OutlineTree | null,
): string | null {
  const cp = config?.currentPosition;
  if (cp !== null && cp !== undefined && cp !== "" && chapterNodeExists(tree, cp)) return cp;
  return lastChapterNode(tree);
}

// ============ 复合写请求构造（推进/回收/废弃；状态变化 + 复合写） ============

export type HookLifecycleKind = "advance" | "resolve" | "abandon";

/** 生命周期动作 → 目标状态（planted → progressing → resolved 或 abandoned） */
export const LIFECYCLE_STATUS: Record<HookLifecycleKind, string> = {
  advance: "progressing",
  resolve: "resolved",
  abandon: "abandoned",
};

/** 推进/回收的关系类型（abandon 无关系—— abandon_hook 仅 delta）；锚点节点为章（卡片 1.3） */
export const LIFECYCLE_RELATION_TYPE: Record<Exclude<HookLifecycleKind, "abandon">, string> = {
  advance: "advances",
  resolve: "resolves",
};

/** 状态变更 change（**op=set**：data.status 是物化事实字段，不声明 from——
 * 契约见 docs/design/10-data-model.md §4「物化事实字段不用 CAS」（卡 1.9 裁决 a） */
export function buildStatusDeltaChange(to: string): DeltaChange {
  return { field: "status", op: "set", to };
}

/** 生命周期关系请求体（outline_node → hook，advances/resolves—— 关系约定；请求snake_case） */
export function buildLifecycleRelationBody(
  kind: Exclude<HookLifecycleKind, "abandon">,
  hookId: string,
  nodeId: string,
): CreateRelationBody {
  return {
    source_type: "outline_node",
    source_id: nodeId,
    target_type: "hook",
    target_id: hookId,
    relation_type: LIFECYCLE_RELATION_TYPE[kind],
  };
}

/** 新建伏笔的埋点关系请求体（outline_node → hook，plants；新建交互） */
export function buildPlantRelationBody(hookId: string, plantNodeId: string): CreateRelationBody {
  return {
    source_type: "outline_node",
    source_id: plantNodeId,
    target_type: "hook",
    target_id: hookId,
    relation_type: "plants",
  };
}

/** data.status 同步负载（浅合并单键——S6.7「状态同步」语义：data.status 为唯一事实来源） */
export function buildStatusSyncData(to: string): Record<string, unknown> {
  return { status: to };
}

// ============ 复合写编排（推进/回收/废弃；「一次提交」） ============

export interface LifecycleWriteInput {
  kind: "advance" | "resolve";
  hookId: string;
 /** 触发节点（大纲选择器；须存在且未软删，服务端校验） */
  nodeId: string;
  description: string;
}

/**
 * 推进/回收复合写（「POST /delta + POST /relation 一次提交」）。
 * REST 无事务，逐请求逼近 executor 的 withTransaction 复合写，顺序 3 步：
 * 1. POST /delta —— 记状态变化（**op=set**，卡 1.9：物化事实字段不声明 from）
 * 2. POST /relation —— 插 advances/resolves 关系；
 * 409 RELATION_EXISTS（同三元组已存在，——上次已推进过/并发重复确认）
 * = 幂等命中，放行不视为失败（executor 幂等判重同语义：不重复写）
 * 3. PUT /entity —— 同步 data.status（executor「状态同步（S6.7 修复轮必须改）」同款：
 * 复合写后 data.status 必须跟进，否则列表分组与终态守卫均以陈旧值为准）
 * 失败边界：任一步失败 → 抛出（面板内联错误）；已写部分不回滚，重试经幂等收敛
 * （relation 重复 409 放行、delta 为 set 单点状态重复写可安全覆盖、status 同步幂等）
 */
export async function runLifecycleWrite(input: LifecycleWriteInput): Promise<void> {
  const to = LIFECYCLE_STATUS[input.kind];
  await createDelta({
    node_id: input.nodeId,
    target_type: "hook",
    target_id: input.hookId,
    changes: [buildStatusDeltaChange(to)],
    description: input.description,
  });
  try {
    await createRelation(buildLifecycleRelationBody(input.kind, input.hookId, input.nodeId));
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "RELATION_EXISTS")) throw err;
  }
  await updateEntity("hook", input.hookId, { data: buildStatusSyncData(to) });
}

export interface AbandonWriteInput {
  hookId: string;
 /** 锚定节点（anchorNodeForAbandon 计算；null 时调用方应禁止提交） */
  nodeId: string;
  description: string;
}

/** 废弃复合写（仅 delta + status 同步，无关系—— abandon_hook：args 无 node_id、不插关系） */
export async function runAbandonWrite(input: AbandonWriteInput): Promise<void> {
  await createDelta({
    node_id: input.nodeId,
    target_type: "hook",
    target_id: input.hookId,
    changes: [buildStatusDeltaChange("abandoned")],
    description: input.description,
  });
  await updateEntity("hook", input.hookId, { data: buildStatusSyncData("abandoned") });
}
