// @ai-editor/tools 入口：导出工具上下文 / 注册表 / 查询类与分析类工具实现
// S6.3 查询类工具（自动权限，8 个）+ S6.4 分析类工具（自动权限，5 个）在此注册；
// S6.5 伏笔 / S6.6 提案 / S6.7 执行 + executor 通过 registry.registerTool(s) 继续挂载
// （注册表是唯一事实来源）。
//
// 注册语义：模块副作用注册（import 即挂载）——S7.4 executor 直接 getTool(name) 调度；
// 工具定义集中在各 query/analysis 模块（name/description/argsSchema/permission/run），
// 本入口统一注册并导出全部 API。

// 包标识常量（与 shared/llm 包风格一致：SHARED_PKG_NAME/LLM_PKG_NAME；agent 冒烟依赖）
export const TOOLS_PKG_NAME = "@ai-editor/tools";
export const TOOLS_PKG_VERSION = "0.1.0";

export * from "./context.js";
export * from "./registry.js";
export * from "./query/entity.js";
export * from "./query/relation.js";
export * from "./query/outline.js";
export * from "./query/delta.js";
export * from "./analysis/utils.js";
export * from "./analysis/consistency.js";
export * from "./analysis/conflict.js";
export * from "./analysis/path.js";
export * from "./analysis/orphan.js";
export * from "./analysis/suggest.js";
export * from "./analysis/hook.js";
export * from "./proposal/types.js";
export * from "./proposal/entity.js";
export * from "./proposal/relation.js";
export * from "./proposal/delta.js";
export * from "./proposal/outline.js";
export * from "./proposal/hook.js";

import { TOOL_PERMISSION } from "@ai-editor/shared";
import {
  computeStateArgsSchema,
  getDeltaHistoryArgsSchema,
  getEntityArgsSchema,
  getEntitySummaryArgsSchema,
  getOutlineArgsSchema,
  getOutlinePathArgsSchema,
  queryRelationshipsArgsSchema,
  searchEntitiesArgsSchema,
} from "@ai-editor/shared/schemas/tools";
import { registerTools, type ToolDefinition } from "./registry.js";
import { runGetEntity, runGetEntitySummary, runSearchEntities } from "./query/entity.js";
import { runQueryRelationships } from "./query/relation.js";
import { runGetOutline, runGetOutlinePath } from "./query/outline.js";
import { runComputeState, runGetDeltaHistory } from "./query/delta.js";

/** 查询类工具定义（S6.3，tools.md「查询类（自动）」8 个；权限全为 AUTO） */
const queryToolDefs: ToolDefinition[] = [
  {
    name: "get_entity",
    description:
      "实体详情查询：按类型与 id 获取单个实体（含 data 字段完整内容）。" +
      "type 取值 character|setting|location|hook；id 为实体 id（char-/set-/loc-/hook- 前缀）。" +
      "不存在或已软删返回 null。",
    argsSchema: getEntityArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runGetEntity,
  },
  {
    name: "search_entities",
    description:
      "实体搜索：按类型 + 名称关键词模糊匹配（可附 filters：status 精确匹配 data.status、" +
      "tags 要求 data.tags 数组包含全部指定标签）。返回匹配实体列表（名称 + 类型 + 关键字段摘要）。",
    argsSchema: searchEntitiesArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runSearchEntities,
  },
  {
    name: "query_relationships",
    description:
      "关系图查询：按端点/关系类型过滤（depth 1=紧邻直接关系、2=k跳路径、3=全量遍历）。" +
      "端点可为实体或大纲节点（outline_node）；relation_type 取值限定预定义 16 种：" +
      "belongs_to/owns/masters/ally/rival/mentor/family/kills/appears_in/occurs_at/" +
      "plot_edge/plants/advances/resolves/depends_on/involves；端点软删的关系不可见。",
    argsSchema: queryRelationshipsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runQueryRelationships,
  },
  {
    name: "get_outline",
    description:
      "完整大纲树查询（严格三层：卷→章→场景）。默认不含 metadata 统计（省 token）；" +
      "软删节点不返回。用于了解作品整体结构。",
    argsSchema: getOutlineArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runGetOutline,
  },
  {
    name: "get_outline_path",
    description:
      "大纲节点路径查询：返回从根到指定节点的路径 ID 列表（含 root，如 [root, vol-1, ch-3, sc-15]）。" +
      "节点不存在或已软删返回 null。",
    argsSchema: getOutlinePathArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runGetOutlinePath,
  },
  {
    name: "compute_state",
    description:
      "状态计算：实体（target_id）到达指定大纲节点（at_node_id）时的累积状态——" +
      "只沿大纲树父链累积已确认 Delta。若存在 update 冲突（from 不匹配）该 change 被跳过，" +
      "结果在 conflicts 字段标注 { field, expected, actual }，请据此向用户提示修复。",
    argsSchema: computeStateArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runComputeState,
  },
  {
    name: "get_delta_history",
    description:
      "Delta 历史查询：目标实体的全部属性变更记录（按时间/节点排序）。" +
      "target_type 为实体类型或 outline_node；软删相关记录自动过滤。",
    argsSchema: getDeltaHistoryArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runGetDeltaHistory,
  },
  {
    name: "get_entity_summary",
    description:
      "实体聚合统计：指定类型实体的总数与分布（character→角色/状态/能力分布、hook→状态/兑现时机分布、" +
      "setting→分类分布、location→类型分布）。用于全局概览。",
    argsSchema: getEntitySummaryArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runGetEntitySummary,
  },
];

registerTools(queryToolDefs);

import {
  analyzeConsistencyArgsSchema,
  detectConflictsArgsSchema,
  findOrphanElementsArgsSchema,
  suggestConnectionsArgsSchema,
  tracePlotPathsArgsSchema,
} from "@ai-editor/shared/schemas/tools";
import { runAnalyzeConsistency } from "./analysis/consistency.js";
import { runDetectConflicts } from "./analysis/conflict.js";
import { runTracePlotPaths } from "./analysis/path.js";
import { runFindOrphanElements } from "./analysis/orphan.js";
import { runSuggestConnections } from "./analysis/suggest.js";

/** 分析类工具定义（S6.4，tools.md「分析类（自动）」5 个；权限全为 AUTO，长任务执行中检查 signal） */
const analysisToolDefs: ToolDefinition[] = [
  {
    name: "analyze_consistency",
    description:
      "实体档案一致性检查：检查单个实体 data 内部的矛盾（如性格反义词对并存、负年龄、" +
      "伏笔已兑现但未标注兑现节点、expected_resolve_node_id/parent_id 悬空引用）。" +
      "返回 issues: [{ severity: error|warning, field, description }]；实体不存在或已软删返回 null。",
    argsSchema: analyzeConsistencyArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runAnalyzeConsistency,
  },
  {
    name: "detect_conflicts",
    description:
      "跨实体设定矛盾检测：扫描关系图发现不一致——对称关系（ally/family）单向缺失、" +
      "同一对实体互斥关系并存（ally+rival）、互相击杀（双向 kills）。" +
      "types 限定实体类型、relation_filter 限定参与检测的关系类型（缺省全量）。" +
      "返回 conflicts: [{ entity_a, entity_b, field, description }]。",
    argsSchema: detectConflictsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runDetectConflicts,
  },
  {
    name: "trace_plot_paths",
    description:
      "剧情路径推演：从 from_node_id 到 to_node_id 推演可能的推进路径——沿大纲树的直接链" +
      "（祖先后裔）与沿 plot_edge 剧情连线的 k 跳路径。每条路径含 nodes/description/risk_factors" +
      "（过长路径、场景缺目标、章节缺反转等风险）。节点不存在或已软删返回 null。",
    argsSchema: tracePlotPathsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runTracePlotPaths,
  },
  {
    name: "find_orphan_elements",
    description:
      "全项目孤立元素诊断（无参）：unused_characters（从未出场或最后活跃章早于当前最新章的角色）、" +
      "unresolved_deltas（触发节点缺失/目标端点软删或缺失的永不生效变更）、" +
      "dangling_relations（端点已物理删除的悬空关系）、" +
      "inconsistent_soft_deletes（大纲节点已软删但关联 relation/delta 未级联软删的跨存储不一致，诊断用途）。",
    argsSchema: findOrphanElementsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runFindOrphanElements,
  },
  {
    name: "suggest_connections",
    description:
      "潜在关系发现：为指定实体建议同类型实体的潜在关联——共同出现于同一场景（同场戏）、" +
      "共享关联实体（朋友的朋友）。返回 suggestions: [{ target_id, relation_type: ally, reason }]" +
      "（已有直接关系的候选跳过）。实体不存在或已软删返回 null。",
    argsSchema: suggestConnectionsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runSuggestConnections,
  },
];

registerTools(analysisToolDefs);

import {
  analyzeHookHealthArgsSchema,
  detectHookConflictsArgsSchema,
  findHookOpportunitiesArgsSchema,
  suggestHookPayoffArgsSchema,
  traceHookLifecycleArgsSchema,
} from "@ai-editor/shared/schemas/tools";
import { runAnalyzeHookHealth, runDetectHookConflicts, runFindHookOpportunities, runSuggestHookPayoff, runTraceHookLifecycle } from "./analysis/hook.js";

/** 伏笔分析工具定义（S6.5，hooks.md「工具扩展」+ 决策 21；权限全为 AUTO） */
const hookToolDefs: ToolDefinition[] = [
  {
    name: "analyze_hook_health",
    description:
      "伏笔健康总览（无参）：统计全部活跃伏笔（planted/progressing）——stale（休眠超过半衰期）、" +
      "overdue（埋设超过两倍半衰期）、blocked（依赖尚未回收）及人类可读 warnings。" +
      "返回 { current_chapter, active_count, stale, overdue, blocked_chains, warnings }；" +
      "半衰期显式 half_life 优先、缺省按 payoff_timing 映射（immediate=3/near_term=8/mid_arc=15/slow_burn=25/endgame=40，决策 21）。",
    argsSchema: analyzeHookHealthArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runAnalyzeHookHealth,
  },
  {
    name: "trace_hook_lifecycle",
    description:
      "伏笔生命周期追踪：返回 hook 详情 + 埋设节点（plant，最早埋设）+ 全部推进节点（advances，按章节序）+ " +
      "回收节点（resolve，最新）+ 当前休眠章数（dormancy）+ 时间线图（timeline_graph.events 按章节序合并）。" +
      "hook 不存在或已软删返回 null。",
    argsSchema: traceHookLifecycleArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runTraceHookLifecycle,
  },
  {
    name: "suggest_hook_payoff",
    description:
      "伏笔回收建议：基于埋设章节与半衰期（显式优先、缺省按 payoff_timing 映射）推荐理想回收场景" +
      "（节奏匹配 top 3，候选为当前章节之后的未回收场景）。返回 { suggestions: [{ at_node, reason }] }；" +
      "hook 不存在/已软删返回 null，无埋设记录或大纲无候选场景返回空建议。",
    argsSchema: suggestHookPayoffArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runSuggestHookPayoff,
  },
  {
    name: "find_hook_opportunities",
    description:
      "伏笔埋设机会发现：分析指定大纲节点的叙事特征（尚无伏笔埋设、角色在场数、场景冲突层次、价值转向）" +
      "建议适合的伏笔类别（mystery/relationship/world_building/character_growth）。" +
      "返回 { opportunities: [{ category, reason }] }；节点不存在或已软删返回 null。",
    argsSchema: findHookOpportunitiesArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runFindHookOpportunities,
  },
  {
    name: "detect_hook_conflicts",
    description:
      "伏笔矛盾检测（无参）：依赖循环（A↔B 互相 depends_on）、依赖已废弃（depends_on 指向 abandoned 伏笔）、" +
      "时间悖论（推进/回收节点章节早于埋设节点章节）。返回 { conflicts: [{ hook_a, hook_b, field, description }] }。",
    argsSchema: detectHookConflictsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    run: runDetectHookConflicts,
  },
];

registerTools(hookToolDefs);

import {
  proposeAbandonHookArgsSchema,
  proposeAddDeltaArgsSchema,
  proposeAddRelationArgsSchema,
  proposeAdvanceHookArgsSchema,
  proposeCreateEntityArgsSchema,
  proposeCreateHookArgsSchema,
  proposeDeleteEntityArgsSchema,
  proposeDeleteNodeArgsSchema,
  proposeMoveNodeArgsSchema,
  proposeOutlineNodeArgsSchema,
  proposeRemoveRelationArgsSchema,
  proposeResolveHookArgsSchema,
  proposeUpdateEntityArgsSchema,
  proposeUpdateHookArgsSchema,
} from "@ai-editor/shared/schemas/tools";
import {
  runProposeAbandonHook,
  runProposeAdvanceHook,
  runProposeCreateHook,
  runProposeResolveHook,
  runProposeUpdateHook,
} from "./proposal/hook.js";
import {
  runProposeCreateEntity,
  runProposeDeleteEntity,
  runProposeUpdateEntity,
} from "./proposal/entity.js";
import {
  runProposeAddRelation,
  runProposeRemoveRelation,
} from "./proposal/relation.js";
import { runProposeAddDelta } from "./proposal/delta.js";
import {
  runProposeDeleteNode,
  runProposeMoveNode,
  runProposeOutlineNode,
} from "./proposal/outline.js";

/** 提案类工具定义（S6.6，tools.md「提案类」+ hooks.md「工具扩展」提案类，共 14 个；权限全为 PROPOSAL）
 * 语义：AI 不能直接修改数据——propose_* 仅产出提案（tool_result 只有 proposal_id + 一句话摘要，
 * 不含预览细节，2026-08 修订；完整预览经 SSE proposal 事件推送 GUI）；用户确认后由 S7.5 路由
 * 快照重校验并调用 S6.7 执行工具落库。 */
const proposalToolDefs: ToolDefinition[] = [
  {
    name: "propose_create_entity",
    description:
      "创建实体提案：向用户提议新建实体。type 取值 character|setting|location|hook，name 必填，" +
      "data 可选（自定义字段，如角色 role/status、伏笔 payoff_timing）。" +
      "仅生成提案（返回 proposal_id + 一句话摘要），需用户在界面确认后才生效——请勿重复提案或视为已创建。",
    argsSchema: proposeCreateEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeCreateEntity,
  },
  {
    name: "propose_update_entity",
    description:
      "更新实体提案：entity_id 指定实体，patches 为要修改的 data 字段（至少一项，浅合并——未传字段保留）。" +
      "仅生成提案，需用户确认后生效；确认时服务端校验实体未被他人改动（updated_at 快照比对），" +
      "实体不存在或已软删返回错误。",
    argsSchema: proposeUpdateEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeUpdateEntity,
  },
  {
    name: "propose_delete_entity",
    description:
      "删除实体提案：软删指定实体及其关联关系与 Delta（可回收站还原，非物理清除）。" +
      "仅生成提案，需用户确认后生效；实体不存在或已软删返回错误。",
    argsSchema: proposeDeleteEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeDeleteEntity,
  },
  {
    name: "propose_add_relation",
    description:
      "新增关系提案：source/target 为端点 id（实体 id 如 char-xxx，或大纲节点 id 如 ch-xxx，" +
      "类型自动识别），type 为预定义关系类型（belongs_to/owns/masters/ally/rival/mentor/family/" +
      "kills/appears_in/occurs_at/plot_edge/plants/advances/resolves/depends_on/involves），" +
      "metadata 可选。仅生成提案，需用户确认后生效；端点不存在或已软删返回错误。",
    argsSchema: proposeAddRelationArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeAddRelation,
  },
  {
    name: "propose_remove_relation",
    description:
      "移除关系提案：relation_id 指定要移除的关系（确认后物理删除，不进回收站）。" +
      "仅生成提案，需用户确认后生效；关系不存在或端点已软删返回错误。",
    argsSchema: proposeRemoveRelationArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeRemoveRelation,
  },
  {
    name: "propose_add_delta",
    description:
      "追加属性变更提案：node_id 为触发变更的大纲节点，target 为变更目标（实体 id 或大纲节点 id，" +
      "类型自动识别），changes 为变更列表（op 取值 set/update/add/remove，至少一项；" +
      "update 需 from 旧值，add/remove 用 value）。仅生成提案，需用户确认后生效；" +
      "触发节点或目标不存在/已软删返回错误。",
    argsSchema: proposeAddDeltaArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeAddDelta,
  },
  {
    name: "propose_outline_node",
    description:
      "新增大纲节点提案：type 取值 volume|chapter|scene（严格三层：卷挂根、章挂卷或根、" +
      "场景必须挂章），title 必填，parent_id 指定父节点（缺省挂根）。" +
      "仅生成提案，需用户确认后生效；父节点不存在/已软删或层级非法返回错误。",
    argsSchema: proposeOutlineNodeArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeOutlineNode,
  },
  {
    name: "propose_move_node",
    description:
      "移动大纲节点提案：node_id 移到 parent_id 下的 order 位置（0 起计数）。" +
      "仅生成提案，需用户确认后生效；目标父层级非法（严格三层，决策 19）、" +
      "节点或父不存在/已软删返回错误。",
    argsSchema: proposeMoveNodeArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeMoveNode,
  },
  {
    name: "propose_delete_node",
    description:
      "删除大纲节点提案：软删指定节点及其整棵子树（可回收站还原，非物理清除）。" +
      "仅生成提案，需用户确认后生效；节点不存在或已软删返回错误。",
    argsSchema: proposeDeleteNodeArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeDeleteNode,
  },
  {
    name: "propose_create_hook",
    description:
      "创建伏笔提案：name 必填，data 可选（伏笔字段：payoff_timing、half_life、expected_resolve_node_id、category 等），" +
      "plant_at_node_id 可选指定埋设节点（确认后建立 plants 关系）。" +
      "仅生成提案，需用户确认后生效；埋设节点不存在/已软删返回错误。",
    argsSchema: proposeCreateHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeCreateHook,
  },
  {
    name: "propose_update_hook",
    description:
      "更新伏笔提案：hook_id 指定伏笔，patches 为要修改的 data 字段（至少一项，浅合并——未传字段保留）。" +
      "仅生成提案，需用户确认后生效；确认时服务端校验伏笔未被改动（updated_at 快照比对），" +
      "伏笔不存在或已软删返回错误。",
    argsSchema: proposeUpdateHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeUpdateHook,
  },
  {
    name: "propose_advance_hook",
    description:
      "推进伏笔提案：hook_id 指定伏笔，node_id 为推进发生的节点，description 描述推进内容。" +
      "确认后复合写一次提交（Delta 记 status=progressing + advances 关系，幂等）。" +
      "仅生成提案，需用户确认后生效；伏笔或节点不存在/已软删返回错误。",
    argsSchema: proposeAdvanceHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeAdvanceHook,
  },
  {
    name: "propose_resolve_hook",
    description:
      "回收伏笔提案：hook_id 指定伏笔，node_id 为回收节点，description 描述回收内容。" +
      "确认后复合写一次提交（Delta 记 status=resolved + resolves 关系，幂等）。" +
      "仅生成提案，需用户确认后生效；伏笔或节点不存在/已软删返回错误。",
    argsSchema: proposeResolveHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeResolveHook,
  },
  {
    name: "propose_abandon_hook",
    description:
      "废弃伏笔提案：hook_id 指定伏笔，description 说明废弃原因。" +
      "确认后复合写一次提交（Delta 记 status=abandoned）。" +
      "仅生成提案，需用户确认后生效；伏笔不存在或已软删返回错误。",
    argsSchema: proposeAbandonHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: runProposeAbandonHook,
  },
];

registerTools(proposalToolDefs);
