// 伏笔面板辅助纯函数与复合写编排（S9.1）
// 契约来源：doc/ui/pages/hook-panel.md（信息层级/关键交互/状态）、doc/database/hooks.md（关系约定与状态变化）、
//   doc/design/decisions.md 决策 21（data.status 缺失视为 planted；current_position 锚点口径）、
//   packages/tools/src/executor/hook.ts（复合写与 status 同步语义参照——REST 链路上的等价逼近）
// MVP 简化（backlog #13）：本模块不消费 _health 字段、不计算章节序——只处理基础字段与生命周期
import type { DeltaChange, EntitySummary, OutlineNode, OutlineTree, ProjectConfig } from "@whispering233/ai-editor-shared";
import {
  ApiError,
  createDelta,
  createRelation,
  updateEntity,
  type CreateRelationBody,
  type RelationSummaryItem,
} from "./api";

// ============ 状态分组（hook-panel.md 信息层级） ============

export type HookGroupKey = "active" | "resolved" | "abandoned";

/**
 * 状态 → 分组：planted/progressing → 活跃；resolved → 已回收；abandoned → 已废弃。
 * 缺失/未知状态归活跃（决策 21 口径：data.status 缺失视为 planted——创建即埋设）
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

/** 列表摘要按状态分组（hook-panel.md「按 summary.status 分组」） */
export function groupHooksByStatus(items: readonly EntitySummary[]): HookGroups {
  const groups: HookGroups = { active: [], resolved: [], abandoned: [] };
  for (const item of items) groups[hookGroupOf(item.summary.status)].push(item);
  return groups;
}

// ============ 关系解析（depends_on：source 依赖 target——hooks.md「B 依赖 A 先解开」） ============

/** 按关系类型过滤（详情 relations 分区：plants/advances/resolves/depends_on/involves） */
export function relationsOfType(
  relations: readonly RelationSummaryItem[],
  relationType: string,
): RelationSummaryItem[] {
  return relations.filter((r) => r.relationType === relationType);
}

/**
 * 本伏笔「依赖的伏笔」名字（depends_on 中 sourceId === hookId → target 名；targetName 缺省用 id）。
 * 行内「依赖: xxx」展示（hook-panel.md 行主信息）
 */
export function dependencyNames(relations: readonly RelationSummaryItem[], hookId: string): string[] {
  return relationsOfType(relations, "depends_on")
    .filter((r) => r.sourceId === hookId)
    .map((r) => r.targetName ?? r.targetId);
}

/** 依赖本伏笔的伏笔名（depends_on 中 targetId === hookId；回收确认面板「有 N 个伏笔依赖此伏笔」） */
export function dependentNames(relations: readonly RelationSummaryItem[], hookId: string): string[] {
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
 * 递归展开「依赖链」（hook-panel.md 关键交互：行内「依赖: 玉佩来历」可点击展开递归链）：
 * - 边语义：source 依赖 target（hooks.md）；从起点沿 depends_on 的 target 逐层下行
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

// ============ 废弃锚点节点（executor anchorNodeForAbandon 同款语义，tools/executor/hook.ts） ============

/** 节点是否存在于大纲树且未软删（current_position 有效性校验，决策 21：须指向非软删节点） */
export function nodeExists(tree: OutlineTree | null, nodeId: string): boolean {
  if (!tree) return false;
  const stack: OutlineNode[] = [...tree.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.id === nodeId) return node.deleted !== true;
    if (node.type !== "scene" && node.children) stack.push(...node.children);
  }
  return false;
}

/**
 * 树末节点（先序遍历最后访问的非软删节点——executor 同款「当前写作进度末端」；
 * 注意是「先序最后」而非「最深叶子」：卷在无子节点时同样可作锚点）。空树 → null
 */
export function lastOutlineNode(tree: OutlineTree | null): string | null {
  if (!tree) return null;
  let last: string | null = null;
  const visit = (node: OutlineNode): void => {
    if (node.deleted === true) return;
    last = node.id;
    if (node.type !== "scene" && node.children) {
      for (const child of node.children) visit(child);
    }
  };
  for (const child of tree.children) visit(child);
  return last;
}

/**
 * 废弃 Delta 锚定节点：current_position 有效（存在且未软删）优先，否则退化树末节点；
 * 大纲空树 → null（面板禁用提交并内联提示——无锚点不可记录，同 executor 抛错语义）
 */
export function anchorNodeForAbandon(config: ProjectConfig | null, tree: OutlineTree | null): string | null {
  const cp = config?.currentPosition;
  if (cp !== null && cp !== undefined && cp !== "" && nodeExists(tree, cp)) return cp;
  return lastOutlineNode(tree);
}

// ============ 复合写请求构造（推进/回收/废弃；hooks.md 状态变化 + tools.md 复合写） ============

export type HookLifecycleKind = "advance" | "resolve" | "abandon";

/** 生命周期动作 → 目标状态（hooks.md：planted → progressing → resolved 或 abandoned） */
export const LIFECYCLE_STATUS: Record<HookLifecycleKind, string> = {
  advance: "progressing",
  resolve: "resolved",
  abandon: "abandoned",
};

/** 推进/回收的关系类型（abandon 无关系——tools.md abandon_hook 仅 delta） */
export const LIFECYCLE_RELATION_TYPE: Record<Exclude<HookLifecycleKind, "abandon">, string> = {
  advance: "advances",
  resolve: "resolves",
};

/** 伏笔当前状态（data.status 缺失/空串 → planted——决策 21 口径，delta 的 from 依据） */
export function currentHookStatus(data: Record<string, unknown>): string {
  const status = data.status;
  return typeof status === "string" && status !== "" ? status : "planted";
}

/** 状态变更 change（hooks.md 状态变化形态：op=update + from 当前状态；决策 9 修订 from 由客户端自动取） */
export function buildStatusDeltaChange(from: string, to: string): DeltaChange {
  return { field: "status", op: "update", from, to };
}

/** 生命周期关系请求体（outline_node → hook，advances/resolves——hooks.md 关系约定；请求契约 snake_case） */
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

/** 新建伏笔的埋点关系请求体（outline_node → hook，plants；hook-panel.md 新建交互） */
export function buildPlantRelationBody(hookId: string, plantNodeId: string): CreateRelationBody {
  return {
    source_type: "outline_node",
    source_id: plantNodeId,
    target_type: "hook",
    target_id: hookId,
    relation_type: "plants",
  };
}

/** data.status 同步负载（浅合并单键——S6.7「状态同步」语义：data.status 为唯一事实来源，决策 21） */
export function buildStatusSyncData(to: string): Record<string, unknown> {
  return { status: to };
}

// ============ 复合写编排（推进/回收/废弃；hook-panel.md「一次提交」） ============

export interface LifecycleWriteInput {
  kind: "advance" | "resolve";
  hookId: string;
  /** delta 的 from（当前 data.status——currentHookStatus 计算） */
  fromStatus: string;
  /** 触发节点（大纲选择器；须存在且未软删，服务端校验） */
  nodeId: string;
  description: string;
}

/**
 * 推进/回收复合写（hook-panel.md：「POST /delta + POST /relation 一次提交」）。
 * REST 无事务，逐请求逼近 executor 的 withTransaction 复合写（tools.md），顺序 3 步：
 *   1. POST /delta —— 记状态变化（hooks.md 状态变化形态）
 *   2. POST /relation —— 插 advances/resolves 关系；
 *      409 RELATION_EXISTS（同三元组已存在，endpoints.md L372——上次已推进过/并发重复确认）
 *      = 幂等命中，放行不视为失败（executor 幂等判重同语义：不重复写）
 *   3. PUT /entity —— 同步 data.status（executor「状态同步（S6.7 修复轮必须改）」同款：
 *      复合写后 data.status 必须跟进，否则列表分组与后续 delta 的 from 校验均以陈旧值为准）
 * 失败边界：任一步失败 → 抛出（面板内联错误）；已写部分不回滚，重试经幂等收敛
 * （relation 重复 409 放行、delta 重复写记录但 from 与仍陈旧的值匹配、status 同步幂等）
 */
export async function runLifecycleWrite(input: LifecycleWriteInput): Promise<void> {
  const to = LIFECYCLE_STATUS[input.kind];
  await createDelta({
    node_id: input.nodeId,
    target_type: "hook",
    target_id: input.hookId,
    changes: [buildStatusDeltaChange(input.fromStatus, to)],
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
  fromStatus: string;
  /** 锚定节点（anchorNodeForAbandon 计算；null 时调用方应禁止提交） */
  nodeId: string;
  description: string;
}

/** 废弃复合写（仅 delta + status 同步，无关系——tools.md abandon_hook：args 无 node_id、不插关系） */
export async function runAbandonWrite(input: AbandonWriteInput): Promise<void> {
  await createDelta({
    node_id: input.nodeId,
    target_type: "hook",
    target_id: input.hookId,
    changes: [buildStatusDeltaChange(input.fromStatus, "abandoned")],
    description: input.description,
  });
  await updateEntity("hook", input.hookId, { data: buildStatusSyncData("abandoned") });
}
