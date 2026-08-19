// AI 工具参数 Zod schema（@whispering233/ai-editor-shared/types/tool.ts，S6.3）
// 契约来源：doc/api/tools.md「查询类（自动）」——8 个查询工具的入参/返回语义；
//   字段名沿用 tools.md 的 snake_case 参数约定（工具参数由 LLM 直接生成，snake_case 与
//   REST 请求体一致）；取值范围引用 constants/entity.ts 既有枚举（EntityType/RelationType），
//   不另造类型。
// **导出边界**：运行时 schema 仅经 @whispering233/ai-editor-shared/schemas/tools 子路径导出（供服务端
//   tools 包/executor 使用）；types/index.ts 的 type-only barrel 只导出推断类型——
//   client 浏览器包不打包 zod 校验函数（与 types/api.ts 同款约束，见 index.ts 头注释）。

import { z } from "zod";
import { ENTITY_TYPES, RELATION_TYPES } from "../constants/entity.js";
import { REFERENCE_TYPES } from "./api.js";
import { deltaChangeSchema } from "./api.js"; // 复用 delta 单条变更 schema（api.ts 已导出）

// ============ get_entity（实体详情，tools.md「实体查询」） ============

/** get_entity 入参：type（实体类型）+ id；id 前缀体系全局唯一，type 用于回显与一致性校验 */
export const getEntityArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
    id: z.string(),
  })
  .strict();

export type GetEntityArgs = z.infer<typeof getEntityArgsSchema>;

// ============ search_entities（实体搜索，tools.md「实体查询」） ============

/**
 * search_entities 入参：type + query（name 模糊匹配）+ filters（data 字段过滤）
 * filters.status：data.status 字符串相等匹配；filters.tags：data.tags 数组须包含全部指定 tags（AND）
 */
export const searchEntitiesArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
    query: z.string(),
    filters: z
      .object({
        tags: z.array(z.string()).optional(),
        status: z.string().optional(),
      })
      .optional(),
  })
  .strict();

export type SearchEntitiesArgs = z.infer<typeof searchEntitiesArgsSchema>;

// ============ query_relationships（关系图子图，tools.md「关系查询」） ============

/**
 * query_relationships 入参：source_type/target_type 为自由字符串（实体类型或 outline_node）；
 * relation_type 用 z.enum(RELATION_TYPES) **白名单校验**（schema.md 预定义 16 种，
 * 与 REST relationQuerySchema 的宽松 string 不同——工具参数由 LLM 生成，枚举提前拦非法值）；
 * depth 1=紧邻 / 2=k跳 / 3=全量（必填，与 API 层一致）
 */
export const queryRelationshipsArgsSchema = z
  .object({
    source_type: z.string().optional(),
    source_id: z.string().optional(),
    target_type: z.string().optional(),
    target_id: z.string().optional(),
    relation_type: z.enum(RELATION_TYPES).optional(),
    depth: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict();

export type QueryRelationshipsArgs = z.infer<typeof queryRelationshipsArgsSchema>;

// ============ get_outline（完整大纲树，tools.md「大纲查询」） ============

/** get_outline 入参：无参；默认不含 metadata 统计（省 token，需统计走 API with_metadata） */
export const getOutlineArgsSchema = z.object({}).strict();

export type GetOutlineArgs = z.infer<typeof getOutlineArgsSchema>;

// ============ get_outline_path（节点路径，tools.md「大纲查询」） ============

/** get_outline_path 入参：node_id（根 → 该节点的路径 ID 列表，含 root） */
export const getOutlinePathArgsSchema = z
  .object({
    node_id: z.string(),
  })
  .strict();

export type GetOutlinePathArgs = z.infer<typeof getOutlinePathArgsSchema>;

// ============ compute_state（状态计算，tools.md「状态查询」） ============

/**
 * compute_state 入参（与 POST /api/v1/delta/compute 同构，api.ts deltaComputeReqSchema）：
 * 目标实体到达 at_node_id 时的累积状态（只沿大纲树父链累积已确认 Delta，决策 9）
 */
export const computeStateArgsSchema = z
  .object({
    target_type: z.string(),
    target_id: z.string(),
    at_node_id: z.string(),
  })
  .strict();

export type ComputeStateArgs = z.infer<typeof computeStateArgsSchema>;

// ============ get_delta_history（Delta 历史，tools.md「状态查询」） ============

/** get_delta_history 入参：target_type + target_id（该实体的全部属性变更记录，按时间/节点排序） */
export const getDeltaHistoryArgsSchema = z
  .object({
    target_type: z.string(),
    target_id: z.string(),
  })
  .strict();

export type GetDeltaHistoryArgs = z.infer<typeof getDeltaHistoryArgsSchema>;

// ============ get_entity_summary（聚合统计，tools.md「聚合分析」） ============

/** get_entity_summary 入参：type（指定类型实体的统计数据：总数 + 类型专属分布） */
export const getEntitySummaryArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
  })
  .strict();

export type GetEntitySummaryArgs = z.infer<typeof getEntitySummaryArgsSchema>;

// ============ 分析类工具（tools.md「分析类（自动）」，S6.4） ============

// === analyze_consistency（一致性分析） ===

/** analyze_consistency 入参：entity_id（检查该实体档案内部的矛盾，如性格反义词对/状态冲突） */
export const analyzeConsistencyArgsSchema = z
  .object({
    entity_id: z.string(),
  })
  .strict();

export type AnalyzeConsistencyArgs = z.infer<typeof analyzeConsistencyArgsSchema>;

// === detect_conflicts（跨实体矛盾检测） ===

/**
 * detect_conflicts 入参：types 限定参与检测的实体类型（缺省全部）；
 * relation_filter 限定参与检测的关系类型（缺省用内置对称/互斥/互杀规则集）。
 * 检测对象：对称关系单向缺失（ally/family）、互斥关系并存（ally+rival）、互杀（kills×2）。
 */
export const detectConflictsArgsSchema = z
  .object({
    types: z.array(z.enum(ENTITY_TYPES)).optional(),
    relation_filter: z.array(z.enum(RELATION_TYPES)).optional(),
  })
  .strict();

export type DetectConflictsArgs = z.infer<typeof detectConflictsArgsSchema>;

// === trace_plot_paths（剧情路径推演） ===

/** trace_plot_paths 入参：from_node_id → to_node_id（大纲节点；输出树路径 + plot_edge 连线路径） */
export const tracePlotPathsArgsSchema = z
  .object({
    from_node_id: z.string(),
    to_node_id: z.string(),
  })
  .strict();

export type TracePlotPathsArgs = z.infer<typeof tracePlotPathsArgsSchema>;

// === find_orphan_elements（孤立元素诊断） ===

/** find_orphan_elements 入参：无参（全项目扫描：闲置角色/未解决变更/悬空关系/跨存储软删不一致） */
export const findOrphanElementsArgsSchema = z.object({}).strict();

export type FindOrphanElementsArgs = z.infer<typeof findOrphanElementsArgsSchema>;

// === suggest_connections（关系发现） ===

/** suggest_connections 入参：entity_id（基于共享场景/共同邻居/同分类等信号建议潜在关联） */
export const suggestConnectionsArgsSchema = z
  .object({
    entity_id: z.string(),
  })
  .strict();

export type SuggestConnectionsArgs = z.infer<typeof suggestConnectionsArgsSchema>;

// ============ 伏笔分析工具（hooks.md「工具扩展」+ 决策 21，S6.5） ============

// === analyze_hook_health（伏笔健康总览） ===

/** analyze_hook_health 入参：无参（全项目活跃伏笔健康总览：stale/overdue/blocked/warnings） */
export const analyzeHookHealthArgsSchema = z.object({}).strict();

export type AnalyzeHookHealthArgs = z.infer<typeof analyzeHookHealthArgsSchema>;

// === trace_hook_lifecycle（生命周期追踪） ===

/** trace_hook_lifecycle 入参：hook_id（埋设/推进/回收节点 + 休眠章数 + 时间线图） */
export const traceHookLifecycleArgsSchema = z
  .object({
    hook_id: z.string(),
  })
  .strict();

export type TraceHookLifecycleArgs = z.infer<typeof traceHookLifecycleArgsSchema>;

// === suggest_hook_payoff（回收建议） ===

/** suggest_hook_payoff 入参：hook_id（基于埋设章节与半衰期推荐理想回收场景，top 3） */
export const suggestHookPayoffArgsSchema = z
  .object({
    hook_id: z.string(),
  })
  .strict();

export type SuggestHookPayoffArgs = z.infer<typeof suggestHookPayoffArgsSchema>;

// === find_hook_opportunities（埋设机会发现） ===

/** find_hook_opportunities 入参：outline_node_id（分析节点叙事特征，建议适合的伏笔类别） */
export const findHookOpportunitiesArgsSchema = z
  .object({
    outline_node_id: z.string(),
  })
  .strict();

export type FindHookOpportunitiesArgs = z.infer<typeof findHookOpportunitiesArgsSchema>;

// === detect_hook_conflicts（伏笔矛盾检测） ===

/** detect_hook_conflicts 入参：无参（依赖循环/依赖废弃/时间悖论检测） */
export const detectHookConflictsArgsSchema = z.object({}).strict();

export type DetectHookConflictsArgs = z.infer<typeof detectHookConflictsArgsSchema>;

// ============ 提案类工具（tools.md「提案类（需确认）」+ hooks.md「工具扩展」提案类，S6.6） ============
//
// 语义（tools.md「返回语义」2026-08 修订）：AI **不能直接修改数据**——propose_* 仅产出
// 提案对象（proposal_id + 一句话摘要），tool_result 不含预览细节（避免 LLM 误以为提案已生效
// 而重复提案）；完整预览只经 SSE proposal 事件推送 GUI（S7 实现）。
// 参数签名与 tools.md 逐字对齐（propose_add_relation(source, target, type, metadata?) 等）：
// 端点 id（source/target/plant_at_node_id 等）由服务端在生成时自动识别实体/大纲节点类型
// 并采集 updated_at 快照（决策 14/19），故入参只需 id 字符串。
// patches（部分更新字段）拒绝空对象——空补丁提案无意义（生成时校验）。

// === propose_create_entity（创建实体提案） ===

/** 入参：type（实体类型）+ name（必填）+ data（可选自定义字段） */
export const proposeCreateEntityArgsSchema = z
  .object({
    type: z.enum(ENTITY_TYPES),
    name: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ProposeCreateEntityArgs = z.infer<typeof proposeCreateEntityArgsSchema>;

// === propose_update_entity（更新实体提案） ===

/** 入参：entity_id + patches（data 部分字段，至少一项）；快照校验基于实体自身 updated_at（决策 14） */
export const proposeUpdateEntityArgsSchema = z
  .object({
    entity_id: z.string(),
    patches: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, {
      message: "patches 不能为空（至少一项变更）",
    }),
  })
  .strict();

export type ProposeUpdateEntityArgs = z.infer<typeof proposeUpdateEntityArgsSchema>;

// === propose_delete_entity（删除实体提案） ===

/** 入参：entity_id（软删 + 级联，可回收站还原，决策 12） */
export const proposeDeleteEntityArgsSchema = z
  .object({
    entity_id: z.string(),
  })
  .strict();

export type ProposeDeleteEntityArgs = z.infer<typeof proposeDeleteEntityArgsSchema>;

// === propose_add_relation（新增关系提案） ===

/**
 * 入参：source/target 为端点 id（实体 id 或大纲节点 id，类型生成时自动识别）；
 * type 白名单（RELATION_TYPES 16 种，含 plot_edge/plants/advances/resolves）；metadata 可选
 */
export const proposeAddRelationArgsSchema = z
  .object({
    source: z.string(),
    target: z.string(),
    type: z.enum(RELATION_TYPES),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ProposeAddRelationArgs = z.infer<typeof proposeAddRelationArgsSchema>;

// === propose_remove_relation（移除关系提案） ===

/** 入参：relation_id（手动删关系 = 物理删，不进回收站，决策 12） */
export const proposeRemoveRelationArgsSchema = z
  .object({
    relation_id: z.string(),
  })
  .strict();

export type ProposeRemoveRelationArgs = z.infer<typeof proposeRemoveRelationArgsSchema>;

// === propose_add_delta（追加属性变更提案） ===

/** 入参：node_id（触发节点）+ target（变更目标 id，实体或大纲节点）+ changes（至少一项，复用 deltaChangeSchema） */
export const proposeAddDeltaArgsSchema = z
  .object({
    node_id: z.string(),
    target: z.string(),
    changes: z.array(deltaChangeSchema).min(1),
  })
  .strict();

export type ProposeAddDeltaArgs = z.infer<typeof proposeAddDeltaArgsSchema>;

// === propose_outline_node（新增大纲节点提案） ===

/** 入参：type（volume|chapter|scene）+ title + parent_id（缺省挂根；scene 必须挂 chapter，决策 19） */
export const proposeOutlineNodeArgsSchema = z
  .object({
    type: z.enum(["volume", "chapter", "scene"]),
    title: z.string().min(1),
    parent_id: z.string().optional(),
  })
  .strict();

export type ProposeOutlineNodeArgs = z.infer<typeof proposeOutlineNodeArgsSchema>;

// === propose_move_node（移动大纲节点提案） ===

/**
 * 入参：node_id + parent_id（目标父节点，**可为 "root"**——决策 19 允许 volume/chapter 挂根，
 * db moveOutlineNode 支持 parentId === "root"）+ order（目标位置，0 起）。
 * order 无范围上限：超出目标父 children 长度的行为（clamp 或抛错）由 S6.7/db 执行时定义，
 * 生成时校验不做上限（提案只承载意图，合法性由执行层兜底）。
 */
export const proposeMoveNodeArgsSchema = z
  .object({
    node_id: z.string(),
    parent_id: z.string(),
    order: z.number().int().min(0),
  })
  .strict();

export type ProposeMoveNodeArgs = z.infer<typeof proposeMoveNodeArgsSchema>;

// === propose_delete_node（删除大纲节点提案） ===

/** 入参：node_id（软删 + 递归子树，可回收站还原，决策 12） */
export const proposeDeleteNodeArgsSchema = z
  .object({
    node_id: z.string(),
  })
  .strict();

export type ProposeDeleteNodeArgs = z.infer<typeof proposeDeleteNodeArgsSchema>;

// === propose_create_hook（创建伏笔提案，hooks.md「工具扩展」提案类） ===

/** 入参：name + data（可选伏笔字段，如 payoff_timing/half_life/expected_resolve_node_id）+ plant_at_node_id（可选埋设节点） */
export const proposeCreateHookArgsSchema = z
  .object({
    name: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
    plant_at_node_id: z.string().optional(),
  })
  .strict();

export type ProposeCreateHookArgs = z.infer<typeof proposeCreateHookArgsSchema>;

// === propose_update_hook（更新伏笔提案） ===

/** 入参：hook_id + patches（data 部分字段，至少一项）；快照校验基于伏笔实体自身 updated_at（决策 14） */
export const proposeUpdateHookArgsSchema = z
  .object({
    hook_id: z.string(),
    patches: z.record(z.string(), z.unknown()).refine((p) => Object.keys(p).length > 0, {
      message: "patches 不能为空（至少一项变更）",
    }),
  })
  .strict();

export type ProposeUpdateHookArgs = z.infer<typeof proposeUpdateHookArgsSchema>;

// === propose_advance_hook（推进伏笔提案） ===

/** 入参：hook_id + node_id（推进发生的节点）+ description（推进内容描述；确认后复合写 delta+relations，tools.md） */
export const proposeAdvanceHookArgsSchema = z
  .object({
    hook_id: z.string(),
    node_id: z.string(),
    description: z.string().min(1),
  })
  .strict();

export type ProposeAdvanceHookArgs = z.infer<typeof proposeAdvanceHookArgsSchema>;

// === propose_resolve_hook（回收伏笔提案） ===

/** 入参：hook_id + node_id（回收节点）+ description（回收内容描述；确认后复合写 delta+relations，tools.md） */
export const proposeResolveHookArgsSchema = z
  .object({
    hook_id: z.string(),
    node_id: z.string(),
    description: z.string().min(1),
  })
  .strict();

export type ProposeResolveHookArgs = z.infer<typeof proposeResolveHookArgsSchema>;

// === propose_abandon_hook（废弃伏笔提案） ===

/** 入参：hook_id + description（废弃原因；确认后复合写 delta 记 status=abandoned，tools.md） */
export const proposeAbandonHookArgsSchema = z
  .object({
    hook_id: z.string(),
    description: z.string().min(1),
  })
  .strict();

export type ProposeAbandonHookArgs = z.infer<typeof proposeAbandonHookArgsSchema>;

// === propose_reorder_timepoints（时间轴时间点重排提案，G2，决策 26 修订注记） ===

/**
 * 入参：timepoint_ids——LLM 按时间点 name（时间标签文本）语义识别先后后产出的
 * **有序时间点 id 全量序列**（顺序 = 建议新序，须覆盖当前全部未软删时间点，缺/多/重复
 * 由生成时校验拒绝）；200 = 时间点量上限，与列表 limit 对齐（endpoints.md 契约）。
 * G2 取代 F9 的 propose_reorder_events：事件不再带 time_label，语义序的载体变为时间点实体
 */
export const proposeReorderTimepointsArgsSchema = z
  .object({
    timepoint_ids: z.array(z.string()).min(1).max(200),
  })
  .strict();

export type ProposeReorderTimepointsArgs = z.infer<typeof proposeReorderTimepointsArgsSchema>;

// ============ search_references（参考资料搜索，决策 36，批次九） ============

/**
 * search_references 入参：query 关键词（标题+tags 命中）+ 可选 type 枚举过滤 + 可选 tags 过滤。
 * 返回摘要列表（content 摘要截断 120 字由 db toSummary 承担——全文长文本不随列表返回，防 token 膨胀）
 */
export const searchReferencesArgsSchema = z
  .object({
    query: z.string(),
    type: z.enum(REFERENCE_TYPES).optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export type SearchReferencesArgs = z.infer<typeof searchReferencesArgsSchema>;

// === propose_create_reference（创建参考资料提案，决策 36） ===

/**
 * 入参：name 标题（必填）+ type 分类枚举（缺省 material）+ content 全文长文本 +
 * source 来源（可选）+ tags 标签数组（可选）。无引用对象（新实体 id 由执行时生成）。
 */
export const proposeCreateReferenceArgsSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(REFERENCE_TYPES).optional(),
    content: z.string().optional(),
    source: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export type ProposeCreateReferenceArgs = z.infer<typeof proposeCreateReferenceArgsSchema>;
