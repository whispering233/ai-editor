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
