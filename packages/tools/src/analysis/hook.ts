// 分析类工具：伏笔分析（S6.5，hooks.md「工具扩展」+ 决策 21）
// 5 个工具：analyze_hook_health / trace_hook_lifecycle / suggest_hook_payoff /
//   find_hook_opportunities / detect_hook_conflicts
//
// **`_health` 健康指标（决策 21 口径，本文件核心）**：
// - 章节序：全局章序号（跨卷连续累计）先序遍历；scene 归入所属 chapter；**chapter 不落库**——
//   plants/advances/resolves 不存章节元数据，由关系 source_id 经 ChapterIndex（查询时现推，
//   节点 move 后不陈旧）
// - 当前章节 = project.json 的 current_position（经共享 ChapterIndex，与 S6.4 孤儿工具同口径）
// - half_life：显式优先；缺省按 payoff_timing 映射（immediate=3/near_term=8/mid_arc=15/
//   slow_burn=25/endgame=40）；payoff_timing 缺失/非法 → slow_burn（长线保守默认）
// - ready_to_resolve：expected_resolve_node_id 设置时 = current >= 该节点章节序；
//   未设置/节点无章号 → 未计算（null），不猜测
// - blocked：本 hook 依赖（depends_on 的 target）尚未 resolved
// - **`_health` 不入库**：运行时计算，绝不写回 data（本模块不修改实体行）
//
// 数据访问：db 查询层（listEntities/listRelations/getEntity）+ 纯函数分析，**零原生 SQL**。
// 软删过滤：listEntities/listRelations/getEntity 默认过滤（决策 12）。
// signal：全量 hook 遍历为长任务候选，循环中检查（AbortedError，决策 16 ③）。

import { findOutlineNode, getEntity, listEntities, listRelations, readOutlineFile } from "@whispering233/ai-editor-db";
import { DEFAULT_HALF_LIFE, PAYOFF_TIMING } from "@whispering233/ai-editor-shared";
import type { EntityRow, OutlineFileNode, RelationRecord } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import {
  buildChapterIndex,
  outlineNodeName,
  throwIfAborted,
  type ChapterIndex,
} from "./utils.js";
import type {
  AnalyzeHookHealthArgs,
  DetectHookConflictsArgs,
  FindHookOpportunitiesArgs,
  SuggestHookPayoffArgs,
  TraceHookLifecycleArgs,
} from "@whispering233/ai-editor-shared";

// ============ 数据收集（一次查询层调用支撑全量分析） ============

/** 单个伏笔的完整上下文（实体 + 生命周期关系分组，源数据均来自 db 查询层） */
export interface HookRecord {
  entity: EntityRow;
  /** 埋设节点关系（outline_node → hook，plants） */
  plants: RelationRecord[];
  /** 推进节点关系（advances） */
  advances: RelationRecord[];
  /** 回收节点关系（resolves） */
  resolves: RelationRecord[];
  /** 本 hook 依赖的其他 hook（source=本 hook，depends_on） */
  dependsOn: RelationRecord[];
  /** 依赖本 hook 的其他 hook（target=本 hook，depends_on——循环依赖检测用） */
  dependedOnBy: RelationRecord[];
}

/**
 * 收集全部非软删伏笔及其生命周期关系（一次 listEntities + 两次 listRelations 查询层调用）。
 * status 缺失的 hook 视为 planted（hooks.md 生命周期：创建即埋设）——hookStatuses 供 blocked 判定。
 */
function collectHooks(ctx: ToolContext, signal?: AbortSignal): { hooks: Map<string, HookRecord>; hookStatuses: Map<string, string> } {
  const hooks = new Map<string, HookRecord>();
  const hookStatuses = new Map<string, string>();
  for (const summary of listEntities(ctx.db, { type: "hook", limit: 200 }).items) {
    throwIfAborted(signal);
    const entity = getEntity(ctx.db, summary.id);
    if (entity === null) continue; // 防御：摘要与详情不一致（不应出现）
    hooks.set(summary.id, { entity, plants: [], advances: [], resolves: [], dependsOn: [], dependedOnBy: [] });
    const status = entity.data.status;
    hookStatuses.set(summary.id, typeof status === "string" && status !== "" ? status : "planted");
  }
  // 指向 hook 的关系（plants/advances/resolves 的 target 均为 hook；depends_on 单独处理）
  for (const r of listRelations(ctx.db, { targetType: "hook" }, 1, ctx.outlineDir).relations) {
    const rec = hooks.get(r.targetId);
    if (rec === undefined) continue;
    if (r.relationType === "plants") rec.plants.push(r);
    else if (r.relationType === "advances") rec.advances.push(r);
    else if (r.relationType === "resolves") rec.resolves.push(r);
  }
  // depends_on 全量：双向登记（source=依赖方、target=被依赖方）
  for (const r of listRelations(ctx.db, { relationType: "depends_on" }, 1, ctx.outlineDir).relations) {
    const source = hooks.get(r.sourceId);
    const target = hooks.get(r.targetId);
    if (source !== undefined) source.dependsOn.push(r);
    if (target !== undefined) target.dependedOnBy.push(r);
  }
  return { hooks, hookStatuses };
}

// ============ _health 指标（决策 21 口径） ============

/** 单 hook 健康指标（决策 21；指标名与 hooks.md 逐字对齐） */
export interface HookHealth {
  /** 当前章节 - 埋设章节（无 plants 或当前章节未定 → null） */
  age: number | null;
  /** 当前章节 - 最后活跃章节（advances 最新；无 advances → 埋设章；无埋设 → null） */
  dormancy: number | null;
  /** dormancy > half_life（缺数据 → null） */
  stale: boolean | null;
  /** age > half_life * 2（缺数据 → null） */
  overdue: boolean | null;
  /** expected_resolve_node_id 已设置：current >= 该节点章节序；未设置/节点无章号 → null（不猜测） */
  ready_to_resolve: boolean | null;
  /** 存在依赖（depends_on）尚未 resolved */
  blocked: boolean;
  /** 阻塞本 hook 的依赖 hook id 列表 */
  blocked_by: string[];
  /** 半衰期（显式 half_life 优先；缺省按 payoff_timing 映射，决策 21） */
  half_life: number;
}

/**
 * half_life 缺省映射（决策 21）：显式 half_life（正数）优先；
 * 未设置按 payoff_timing 取 DEFAULT_HALF_LIFE；payoff_timing 缺失/非法 → slow_burn
 * （长线保守默认——避免过早判定 stale 误报）。
 * 防御：trunc 后再次检查 > 0——0 < half_life < 1（如 0.5）截断为 0 会让 stale/overdue 恒真，
 * 此时退化走 payoff_timing 映射（oracle 修复轮）。
 */
export function resolveHalfLife(data: Record<string, unknown>): number {
  if (typeof data.half_life === "number" && Number.isFinite(data.half_life) && data.half_life > 0) {
    const truncated = Math.trunc(data.half_life);
    if (truncated > 0) return truncated;
  }
  const timing = data.payoff_timing;
  if (typeof timing === "string" && (PAYOFF_TIMING as readonly string[]).includes(timing)) {
    return DEFAULT_HALF_LIFE[timing as (typeof PAYOFF_TIMING)[number]];
  }
  return DEFAULT_HALF_LIFE.slow_burn;
}

/** 关系源节点章节序列表（过滤无章号节点；plants 取最早埋设、advances 取最新推进） */
function chapterNumbersOf(chapterIndex: ChapterIndex, relations: readonly RelationRecord[]): number[] {
  const out: number[] = [];
  for (const r of relations) {
    const chapter = chapterIndex.chapterOf(r.sourceId);
    if (chapter !== null) out.push(chapter);
  }
  return out;
}

/**
 * 健康指标计算（决策 21；**纯函数，不修改任何输入**——绝不写回 data）：
 * - age：current - 最早埋设章（plants 章节序 min）
 * - dormancy：current - 最后活跃章（advances 章节序 max；无 advances → 埋设章——埋下后从未推进）
 * - stale/overdue/ready_to_resolve/blocked 见 HookHealth 注释
 */
export function computeHookHealth(
  chapterIndex: ChapterIndex,
  rec: HookRecord,
  hookStatuses: ReadonlyMap<string, string>,
): HookHealth {
  const halfLife = resolveHalfLife(rec.entity.data);
  const current = chapterIndex.currentChapter;

  const plantChapters = chapterNumbersOf(chapterIndex, rec.plants);
  const plantChapter = plantChapters.length > 0 ? Math.min(...plantChapters) : null;
  const advanceChapters = chapterNumbersOf(chapterIndex, rec.advances);
  const lastActiveChapter = advanceChapters.length > 0 ? Math.max(...advanceChapters) : plantChapter;

  const age = current !== null && plantChapter !== null ? current - plantChapter : null;
  const dormancy = current !== null && lastActiveChapter !== null ? current - lastActiveChapter : null;
  const stale = dormancy !== null ? dormancy > halfLife : null;
  const overdue = age !== null ? age > halfLife * 2 : null;

  // ready_to_resolve：expected_resolve_node_id 已设置 → current >= 节点章节序；否则未计算（不猜测）。
  // 指向软删/不存在的节点 → null（决策 12 可见性：软删节点不可作为兑现依据——
  // 与 consistency R4「兑现节点软删报 error」同口径，指标不基于不可见节点计算）
  let readyToResolve: boolean | null = null;
  const expectedNodeId = rec.entity.data.expected_resolve_node_id;
  if (typeof expectedNodeId === "string" && expectedNodeId !== "") {
    const resolveChapter = chapterIndex.chapterOf(expectedNodeId);
    if (resolveChapter !== null && current !== null) {
      readyToResolve = current >= resolveChapter;
    }
  }

  // blocked：本 hook 依赖（depends_on 的 target）尚未 resolved（abandoned 亦未回收 → 永久阻塞）。
  // 软删的依赖 hook 不阻塞（决策 12：软删对象不可见——MVP 取舍，可争辩：软删依赖亦无法满足，
  // 但回收站对象不参与健康判定更符合「不可见即不存在」语义）
  const blockedBy: string[] = [];
  for (const r of rec.dependsOn) {
    const status = hookStatuses.get(r.targetId);
    if (status !== undefined && status !== "resolved") blockedBy.push(r.targetId);
  }

  return {
    age,
    dormancy,
    stale,
    overdue,
    ready_to_resolve: readyToResolve,
    blocked: blockedBy.length > 0,
    blocked_by: blockedBy,
    half_life: halfLife,
  };
}

// ============ analyze_hook_health（伏笔健康总览） ============

/** 伏笔健康总览结果（hooks.md analyze_hook_health 返回结构，字段名逐字对齐 snake_case） */
export interface HookHealthOverview {
  /** 当前章节（current_position 口径，决策 21；未设置时退化树末章） */
  current_chapter: number | null;
  /** 活跃伏笔数（status ∈ planted/progressing） */
  active_count: number;
  /** 休眠超过半衰期的活跃伏笔 id */
  stale: string[];
  /** 埋设超过两倍半衰期的活跃伏笔 id */
  overdue: string[];
  /** 被依赖阻塞的伏笔（blocked）及其阻塞源 */
  blocked_chains: { hookId: string; blockedBy: string[] }[];
  /** 人类可读警告（stale/overdue/blocked 各一条） */
  warnings: string[];
}

/** 活跃判定（status 缺失视为 planted——hooks.md 生命周期创建即埋设） */
function isActive(hookStatuses: ReadonlyMap<string, string>, hookId: string): boolean {
  const status = hookStatuses.get(hookId) ?? "planted";
  return status === "planted" || status === "progressing";
}

/**
 * 伏笔健康总览（hooks.md analyze_hook_health()，无参全项目扫描）。
 * 仅统计活跃伏笔（planted/progressing）；_health 为运行时计算，不写回 data。
 * 输出按 hook id 升序（稳定排序）；signal：循环中检查（决策 16 ③）。
 */
export function runAnalyzeHookHealth(ctx: ToolContext, _args: AnalyzeHookHealthArgs, signal?: AbortSignal): HookHealthOverview {
  const chapterIndex = buildChapterIndex(ctx);
  const { hooks, hookStatuses } = collectHooks(ctx, signal);

  const overview: HookHealthOverview = {
    current_chapter: chapterIndex.currentChapter,
    active_count: 0,
    stale: [],
    overdue: [],
    blocked_chains: [],
    warnings: [],
  };
  for (const [hookId, rec] of hooks) {
    throwIfAborted(signal);
    if (!isActive(hookStatuses, hookId)) continue;
    overview.active_count += 1;
    const health = computeHookHealth(chapterIndex, rec, hookStatuses);
    const name = rec.entity.name;
    if (health.stale === true) {
      overview.stale.push(hookId);
      overview.warnings.push(`「${name}」已 ${health.dormancy} 章未推进，半衰期 ${health.half_life}（stale）`);
    }
    if (health.overdue === true) {
      overview.overdue.push(hookId);
      overview.warnings.push(`「${name}」埋设已 ${health.age} 章，超过两倍半衰期（${health.half_life * 2}），建议尽快回收`);
    }
    if (health.blocked) {
      overview.blocked_chains.push({ hookId, blockedBy: [...health.blocked_by] });
      const blockers = health.blocked_by.map((id) => hooks.get(id)?.entity.name ?? id).join("、");
      overview.warnings.push(`「${name}」被「${blockers}」阻塞（依赖尚未回收）`);
    }
  }
  // 稳定排序（输出可预测）
  overview.stale.sort();
  overview.overdue.sort();
  overview.blocked_chains.sort((a, b) => a.hookId.localeCompare(b.hookId));
  return overview;
}

// ============ trace_hook_lifecycle（生命周期追踪） ============

/** 生命周期节点事件（hooks.md trace_hook_lifecycle） */
export interface HookNodeEvent {
  nodeId: string;
  nodeName: string;
  /** 所属章序号（节点无章号 → null） */
  chapter: number | null;
}

/** 生命周期追踪结果（hooks.md trace_hook_lifecycle(hook_id) 返回结构，字段名逐字对齐 snake_case） */
export interface HookLifecycle {
  hook: EntityRow;
  plant: HookNodeEvent | null;
  /** 推进节点（按章节序升序） */
  advances: HookNodeEvent[];
  resolve: HookNodeEvent | null;
  /** 当前休眠章数（current - 最后活跃章；缺数据 → null） */
  dormancy: number | null;
  /** 时间线图（plant → advances → resolve 按章节序合并） */
  timeline_graph: { events: (HookNodeEvent & { kind: "plant" | "advance" | "resolve" })[] };
}

/** 关系 → 节点事件（source 为大纲节点；name 取 outline title） */
function toNodeEvent(tree: ReturnType<typeof readOutlineFile>, chapterIndex: ChapterIndex, r: RelationRecord): HookNodeEvent {
  return { nodeId: r.sourceId, nodeName: outlineNodeName(tree, r.sourceId), chapter: chapterIndex.chapterOf(r.sourceId) };
}

/**
 * 生命周期追踪（hooks.md trace_hook_lifecycle(hook_id)）。
 * hook 不存在/已软删 → null（查询无结果）；plant 取最早埋设节点、resolve 取最新回收节点；
 * dormancy 口径与 _health 一致（advances 最新，无 advances → 埋设章）。
 */
export function runTraceHookLifecycle(ctx: ToolContext, args: TraceHookLifecycleArgs, signal?: AbortSignal): HookLifecycle | null {
  const entity = getEntity(ctx.db, args.hook_id);
  if (entity === null || entity.type !== "hook") return null;
  throwIfAborted(signal);

  const tree = readOutlineFile(ctx.outlineDir);
  const chapterIndex = buildChapterIndex(ctx);
  const relations = listRelations(ctx.db, { targetType: "hook", targetId: args.hook_id }, 1, ctx.outlineDir).relations;
  const plants = relations.filter((r) => r.relationType === "plants").map((r) => toNodeEvent(tree, chapterIndex, r));
  const advances = relations.filter((r) => r.relationType === "advances").map((r) => toNodeEvent(tree, chapterIndex, r));
  const resolves = relations.filter((r) => r.relationType === "resolves").map((r) => toNodeEvent(tree, chapterIndex, r));

  // plant 取最早（章节序 min；无章号节点按原序保留）、resolve 取最新
  const byChapter = (a: HookNodeEvent, b: HookNodeEvent): number => (a.chapter ?? Infinity) - (b.chapter ?? Infinity);
  const plant = plants.length > 0 ? [...plants].sort(byChapter)[0] : null;
  const resolve = resolves.length > 0 ? [...resolves].sort(byChapter).reverse()[0] : null;
  advances.sort(byChapter);

  // dormancy：current - 最后活跃章（advances 最新或埋设章；hooks.md 公式仅计 advances——
  // resolve 不参与，回收后休眠语义由 status=resolved 表达）
  const lastActive = advances.length > 0 ? advances[advances.length - 1].chapter : plant?.chapter ?? null;
  const dormancy =
    chapterIndex.currentChapter !== null && lastActive !== null ? chapterIndex.currentChapter - lastActive : null;

  // 时间线图：plant/advance/resolve 按章节序合并
  const events: HookLifecycle["timeline_graph"]["events"] = [
    ...(plant !== null ? [{ ...plant, kind: "plant" as const }] : []),
    ...advances.map((e) => ({ ...e, kind: "advance" as const })),
    ...(resolve !== null ? [{ ...resolve, kind: "resolve" as const }] : []),
  ].sort((a, b) => (a.chapter ?? Infinity) - (b.chapter ?? Infinity));

  return { hook: entity, plant, advances, resolve, dormancy, timeline_graph: { events } };
}

// ============ suggest_hook_payoff（回收建议） ============

/** 回收建议结果（hooks.md suggest_hook_payoff(hook_id) 返回结构） */
export interface HookPayoffSuggestion {
  at_node: string;
  reason: string;
}

/**
 * 回收建议（hooks.md suggest_hook_payoff(hook_id)）：
 * 候选 = 大纲中**当前章节之后**（含当前章）的场景节点（非软删），排除已回收节点；
 * 理想回收点 = 埋设章 + 半衰期（节奏匹配）；按与理想点距离升序取 top 3。
 * hook 不存在/已软删 → null；无埋设记录或大纲无候选场景 → 空建议。
 */
export function runSuggestHookPayoff(ctx: ToolContext, args: SuggestHookPayoffArgs, signal?: AbortSignal): { suggestions: HookPayoffSuggestion[] } | null {
  const entity = getEntity(ctx.db, args.hook_id);
  if (entity === null || entity.type !== "hook") return null;
  throwIfAborted(signal);

  const tree = readOutlineFile(ctx.outlineDir);
  const chapterIndex = buildChapterIndex(ctx);
  const halfLife = resolveHalfLife(entity.data);
  const plants = listRelations(ctx.db, { targetType: "hook", targetId: args.hook_id, relationType: "plants" }, 1, ctx.outlineDir).relations;
  const plantChapters = chapterNumbersOf(chapterIndex, plants);
  if (plantChapters.length === 0) return { suggestions: [] }; // 无埋设记录 → 无法基于节奏建议
  const plantChapter = Math.min(...plantChapters);
  const idealChapter = plantChapter + halfLife;

  // 已回收节点（排除）
  const resolvedNodes = new Set(
    listRelations(ctx.db, { targetType: "hook", targetId: args.hook_id, relationType: "resolves" }, 1, ctx.outlineDir).relations.map((r) => r.sourceId),
  );

  // 候选场景：章节序 >= 当前章（current 未定 → 全部）
  interface SceneCandidate {
    nodeId: string;
    nodeName: string;
    chapter: number | null;
  }
  const candidates: SceneCandidate[] = [];
  const visit = (nodes: readonly OutlineFileNode[]): void => {
    for (const node of nodes) {
      if (node.type === "scene" && node.deleted !== true && !resolvedNodes.has(node.id)) {
        const chapter = chapterIndex.chapterOf(node.id);
        if (chapter !== null && (chapterIndex.currentChapter === null || chapter >= chapterIndex.currentChapter)) {
          candidates.push({ nodeId: node.id, nodeName: node.title, chapter });
        }
      }
      const children = (node as { children?: readonly OutlineFileNode[] }).children;
      if (children !== undefined) visit(children);
    }
  };
  visit(tree.children);

  candidates.sort((a, b) => Math.abs(a.chapter! - idealChapter) - Math.abs(b.chapter! - idealChapter));
  const suggestions: HookPayoffSuggestion[] = candidates.slice(0, 3).map((c) => ({
    at_node: c.nodeId,
    reason: `伏笔埋设于第 ${plantChapter} 章（半衰期 ${halfLife}），理想回收点约第 ${idealChapter} 章——「${c.nodeName}」（第 ${c.chapter} 章）节奏匹配，建议在此回收`,
  }));
  return { suggestions };
}

// ============ find_hook_opportunities（埋设机会发现） ============

/** 埋设机会结果（hooks.md find_hook_opportunities(outline_node_id) 返回结构） */
export interface HookOpportunity {
  category: string;
  reason: string;
}

/**
 * 埋设机会发现（hooks.md find_hook_opportunities(outline_node_id)）：
 * 基于节点叙事特征建议适合的伏笔类别（每类别至多一条，规则表驱动）：
 * - R1 无伏笔埋设（无 plants 关系）→ mystery（悬念/谜团）
 * - R2 角色在场 ≥ 2（appears_in 目标）→ relationship（人物关系）
 * - R3 scene 冲突含外部层面（extra_personal）→ world_building（世界观）
 * - R4 scene 价值转向（value_from ≠ value_to 且均非空）→ character_growth（角色成长）
 * 节点不存在/已软删 → null。
 */
export function runFindHookOpportunities(ctx: ToolContext, args: FindHookOpportunitiesArgs, signal?: AbortSignal): { opportunities: HookOpportunity[] } | null {
  const tree = readOutlineFile(ctx.outlineDir);
  const node = findOutlineNode(tree, args.outline_node_id);
  if (node === undefined || node.deleted === true) return null;
  throwIfAborted(signal);

  const opportunities: HookOpportunity[] = [];

  // R1：节点尚无伏笔埋设（plants 关系 source = 本节点）
  const plantsCount = listRelations(ctx.db, { sourceType: "outline_node", sourceId: args.outline_node_id, relationType: "plants" }, 1, ctx.outlineDir).relations.length;
  if (plantsCount === 0) {
    opportunities.push({ category: "mystery", reason: "该节点尚无伏笔埋设，适合设置悬念/谜团类伏笔（mystery）" });
  }

  // R2：在场角色数（appears_in 目标 = 本节点）
  const castCount = listRelations(ctx.db, { targetType: "outline_node", targetId: args.outline_node_id, relationType: "appears_in" }, 1, ctx.outlineDir).relations.length;
  if (castCount >= 2) {
    opportunities.push({ category: "relationship", reason: `节点有 ${castCount} 个角色在场，适合人物关系类伏笔（relationship）` });
  }

  // R3/R4：scene 叙事特征（麦基字段集，决策 23）
  if (node.type === "scene") {
    const conflictLevels = node.data?.conflict_levels;
    if (Array.isArray(conflictLevels) && conflictLevels.includes("extra_personal")) {
      opportunities.push({ category: "world_building", reason: "场景冲突含外部层面（extra_personal），适合世界观类伏笔（world_building）" });
    }
    const valueFrom = node.data?.value_from;
    const valueTo = node.data?.value_to;
    if (typeof valueFrom === "string" && valueFrom !== "" && typeof valueTo === "string" && valueTo !== "" && valueFrom !== valueTo) {
      opportunities.push({ category: "character_growth", reason: `场景价值转向（${valueFrom} → ${valueTo}），适合角色成长类伏笔（character_growth）` });
    }
  }

  return { opportunities };
}

// ============ detect_hook_conflicts（伏笔矛盾检测） ============

/** 伏笔矛盾结果（hooks.md detect_hook_conflicts() 返回结构） */
export interface HookConflict {
  hook_a: string;
  hook_b: string;
  field: string;
  description: string;
}

/**
 * 伏笔矛盾检测（hooks.md detect_hook_conflicts()，无参全项目扫描）：
 * - R1 循环依赖（error）：A depends_on B 且 B depends_on A——永远无法同时回收
 *   **限制（MVP）**：仅检测二元互依赖（A↔B）；三节点及以上长环零检出——依赖图按
 *   depends_on 稀疏构建，长环罕见，需 DFS 找环（后续切片评估），此处明示不静默承诺
 * - R2 依赖已废弃（error）：A depends_on B 且 B abandoned——依赖永远无法满足
 * - R3 回收早于埋设（error）：resolves 节点章节 < plants 节点章节——时间悖论
 * - R4 推进早于埋设（error）：advances 节点章节 < plants 节点章节——时间悖论
 * 输出按 (hook_a, hook_b) 稳定排序；signal：循环中检查（决策 16 ③）。
 */
export function runDetectHookConflicts(ctx: ToolContext, _args: DetectHookConflictsArgs, signal?: AbortSignal): { conflicts: HookConflict[] } {
  const chapterIndex = buildChapterIndex(ctx);
  const { hooks, hookStatuses } = collectHooks(ctx, signal);
  const conflicts: HookConflict[] = [];

  for (const [hookId, rec] of hooks) {
    throwIfAborted(signal);
    const name = rec.entity.name;
    // R1 循环依赖：A 依赖 B 且 B 依赖 A（**仅二元互依赖**，见函数头限制注释；
    // 每对只报一次——仅字典序小者视角检查，hook_a < hook_b）
    for (const r of rec.dependsOn) {
      const other = hooks.get(r.targetId);
      if (other === undefined) continue;
      const otherName = other.entity.name;
      if (hookId < r.targetId && other.dependsOn.some((x) => x.targetId === hookId)) {
        conflicts.push({
          hook_a: hookId,
          hook_b: r.targetId,
          field: "depends_on",
          description: `伏笔「${name}」与「${otherName}」互相依赖（循环依赖），永远无法同时回收`,
        });
      }
      // R2 依赖已废弃
      if (hookStatuses.get(r.targetId) === "abandoned") {
        conflicts.push({
          hook_a: hookId,
          hook_b: r.targetId,
          field: "depends_on",
          description: `「${name}」依赖的伏笔「${otherName}」已废弃（abandoned），依赖永远无法满足`,
        });
      }
    }
    // R3/R4 时间悖论（对比章节序；无章号节点跳过——不做宽松猜测）
    const plantChapters = chapterNumbersOf(chapterIndex, rec.plants);
    if (plantChapters.length > 0) {
      const plantChapter = Math.min(...plantChapters);
      for (const r of rec.resolves) {
        const chapter = chapterIndex.chapterOf(r.sourceId);
        if (chapter !== null && chapter < plantChapter) {
          conflicts.push({
            hook_a: hookId,
            hook_b: hookId,
            field: "timeline",
            description: `伏笔「${name}」的回收节点（第 ${chapter} 章）早于埋设节点（第 ${plantChapter} 章），时间悖论`,
          });
        }
      }
      for (const r of rec.advances) {
        const chapter = chapterIndex.chapterOf(r.sourceId);
        if (chapter !== null && chapter < plantChapter) {
          conflicts.push({
            hook_a: hookId,
            hook_b: hookId,
            field: "timeline",
            description: `伏笔「${name}」的推进节点（第 ${chapter} 章）早于埋设节点（第 ${plantChapter} 章），时间悖论`,
          });
        }
      }
    }
  }

  conflicts.sort((a, b) => (a.hook_a === b.hook_a ? a.hook_b.localeCompare(b.hook_b) : a.hook_a.localeCompare(b.hook_a)));
  return { conflicts };
}
