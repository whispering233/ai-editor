// 工具参数 schema：分析域（核心分析 5 + 伏笔分析 5；权限全为 AUTO）

import { Type, type Static } from "@earendil-works/pi-ai";
import { entityTypeSchema } from "./entity.js";
import { relationTypeSchema } from "./relation.js";

// ============ 核心分析（analysis/*，S6.4） ============

/** analyze_consistency 入参：entity_id（检查该实体档案内部的矛盾） */
export const analyzeConsistencyArgsSchema = Type.Object(
  {
    entity_id: Type.String(),
  },
  { additionalProperties: false },
);

export type AnalyzeConsistencyArgs = Static<typeof analyzeConsistencyArgsSchema>;

/**
 * detect_conflicts 入参：types 限定参与检测的实体类型（缺省全部）；
 * relation_filter 限定参与检测的关系类型（缺省用内置对称/互斥/互杀规则集）。
 */
export const detectConflictsArgsSchema = Type.Object(
  {
    types: Type.Optional(Type.Array(entityTypeSchema)),
    relation_filter: Type.Optional(Type.Array(relationTypeSchema)),
  },
  { additionalProperties: false },
);

export type DetectConflictsArgs = Static<typeof detectConflictsArgsSchema>;

/** trace_plot_paths 入参：from_node_id → to_node_id（大纲节点） */
export const tracePlotPathsArgsSchema = Type.Object(
  {
    from_node_id: Type.String(),
    to_node_id: Type.String(),
  },
  { additionalProperties: false },
);

export type TracePlotPathsArgs = Static<typeof tracePlotPathsArgsSchema>;

/** find_orphan_elements 入参：无参（全项目扫描） */
export const findOrphanElementsArgsSchema = Type.Object({}, { additionalProperties: false });

export type FindOrphanElementsArgs = Static<typeof findOrphanElementsArgsSchema>;

/** suggest_connections 入参：entity_id（建议潜在关联） */
export const suggestConnectionsArgsSchema = Type.Object(
  {
    entity_id: Type.String(),
  },
  { additionalProperties: false },
);

export type SuggestConnectionsArgs = Static<typeof suggestConnectionsArgsSchema>;

// ============ 伏笔分析（analysis/hook.ts，S6.5） ============

/** analyze_hook_health 入参：无参（全项目活跃伏笔健康总览） */
export const analyzeHookHealthArgsSchema = Type.Object({}, { additionalProperties: false });

export type AnalyzeHookHealthArgs = Static<typeof analyzeHookHealthArgsSchema>;

/** trace_hook_lifecycle 入参：hook_id（埋设/推进/回收节点 + 休眠章数 + 时间线图） */
export const traceHookLifecycleArgsSchema = Type.Object(
  {
    hook_id: Type.String(),
  },
  { additionalProperties: false },
);

export type TraceHookLifecycleArgs = Static<typeof traceHookLifecycleArgsSchema>;

/** suggest_hook_payoff 入参：hook_id（基于埋设章节与半衰期推荐理想回收场景） */
export const suggestHookPayoffArgsSchema = Type.Object(
  {
    hook_id: Type.String(),
  },
  { additionalProperties: false },
);

export type SuggestHookPayoffArgs = Static<typeof suggestHookPayoffArgsSchema>;

/** find_hook_opportunities 入参：outline_node_id（分析节点叙事特征，建议伏笔类别） */
export const findHookOpportunitiesArgsSchema = Type.Object(
  {
    outline_node_id: Type.String(),
  },
  { additionalProperties: false },
);

export type FindHookOpportunitiesArgs = Static<typeof findHookOpportunitiesArgsSchema>;

/** detect_hook_conflicts 入参：无参（依赖循环/依赖废弃/时间悖论检测） */
export const detectHookConflictsArgsSchema = Type.Object({}, { additionalProperties: false });

export type DetectHookConflictsArgs = Static<typeof detectHookConflictsArgsSchema>;
