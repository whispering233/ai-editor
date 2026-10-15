// @whispering233/ai-editor-tools 入口：导出工具上下文 / 注册表 / 查询类与分析类工具实现
// S6.3 查询类工具（自动权限，11 个）+ S6.4 分析类工具（自动权限，5 个）在此注册；
// S6.5 伏笔 / S6.6 提案通过 registry.registerTool(s) 继续挂载（注册表是唯一事实来源）。
// S6.7 执行类 13 个**不注册 registry**（LLM 不可见，「核心设计原则」）——
// 仅经 executor 门面（executeProposal）导出，S7.5 提案确认后调用。
//
// 注册语义：模块副作用注册（import 即挂载）——executor 直接 getTool(name) 调度；
// 工具定义集中在本入口（name/description/parameters/permission/scope/run），
// 参数 TypeBox schema 统一从 ./schemas 出口取（见 docs/api/tool-calling.md）。
//
// scope（工作区作用域，2026-10）：本入口的 37 个小说语义工具（实体/大纲/伏笔/Delta/参考资料）
// 一律 `scope: "novel"`——练习工作区不注册它们（含全部 propose_*）；七个练习工具
// （四个只读 + 三个写 AI 产出）标 `scope: "practice"`（装配过滤见 agent `createCustomTools`）。

// 包标识常量（与 shared 包风格一致：SHARED_PKG_NAME；agent 冒烟依赖）
export const TOOLS_PKG_NAME = "@whispering233/ai-editor-tools";

export * from "./context.js";
export * from "./registry.js";
export * from "./schemas/index.js";
export * from "./query/entity.js";
export * from "./query/relation.js";
export * from "./query/outline.js";
export * from "./query/manuscript.js";
export * from "./query/deduction.js";
export * from "./query/delta.js";
export * from "./query/reference.js";
export * from "./query/practice.js";
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
export * from "./proposal/reorder-timepoints.js";
export * from "./proposal/reference.js";
// S6.7 执行层：导出 executor 门面与执行函数（不注册工具——见文件头注释）
export * from "./executor/index.js";

import {
  CHARACTER_PRIORITIES,
  CHARACTER_PRIORITY_LABELS,
  DEFAULT_HALF_LIFE,
  RELATION_TYPES,
  TOOL_PERMISSION,
} from "@whispering233/ai-editor-shared";
import {
  computeStateArgsSchema,
  getChapterTextArgsSchema,
  getDeductionMarksArgsSchema,
  getDeltaHistoryArgsSchema,
  getEntityArgsSchema,
  getEntitySummaryArgsSchema,
  getOutlineArgsSchema,
  getOutlinePathArgsSchema,
  queryRelationshipsArgsSchema,
  searchEntitiesArgsSchema,
  searchReferencesArgsSchema,
} from "./schemas/index.js";
import { registerTools, type ToolDefinition } from "./registry.js";
import { runGetEntity, runGetEntitySummary, runSearchEntities } from "./query/entity.js";
import { runSearchReferences } from "./query/reference.js";
import { runQueryRelationships } from "./query/relation.js";
import { runGetOutline, runGetOutlinePath } from "./query/outline.js";
import { runGetChapterText, DEFAULT_TEXT_PAGE_CHARS, MAX_TEXT_PAGE_CHARS } from "./query/manuscript.js";
import { runGetDeductionMarks } from "./query/deduction.js";
import { runComputeState, runGetDeltaHistory } from "./query/delta.js";

/** 查询类工具定义（S6.3 + 卡 12.9 + D4，「查询类（自动）」11 个；权限全为 AUTO） */
const queryToolDefs: ToolDefinition[] = [
  {
    name: "get_entity",
    description:
      "实体详情查询：按类型与 id 获取单个实体（含 data 字段完整内容）。" +
      "type 取值 character|setting|location|hook|event|timepoint|reference；id 为实体 id（char-/set-/loc-/hook-/ev-/tp-/ref- 前缀）。" +
      "不存在或已软删返回 null。" +
      "reference（参考资料）另附 content = 正文的轻量 md 投影（非块 JSON；未写过正文为空串）。",
    parameters: getEntityArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetEntity,
  },
  {
    name: "search_entities",
    description:
      "实体搜索：按类型 + 名称关键词模糊匹配（可附 filters：status 精确匹配 data.status——" +
      "**仅伏笔（hook）生命周期有意义**（character 已无该字段）；" +
      "tags 要求 data.tags 数组包含全部指定标签）。返回匹配实体列表（名称 + 类型 + 关键字段摘要）。",
    parameters: searchEntitiesArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runSearchEntities,
  },
  {
    name: "query_relationships",
    description:
      "关系图查询：按端点/关系类型过滤（depth 1=紧邻直接关系、2=k跳路径、3=全量遍历）。" +
      "端点可为实体或大纲节点（outline_node）；relation_type 取值限定预定义 " +
      RELATION_TYPES.length +
      " 种：" +
      RELATION_TYPES.join("/") +
      "；端点软删的关系不可见。",
    parameters: queryRelationshipsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runQueryRelationships,
  },
  {
    name: "get_outline",
    description:
      "完整大纲树查询（严格三层：卷→章→场景）。默认不含 metadata 统计（省 token）；" +
      "软删节点不返回。用于了解作品整体结构。",
    parameters: getOutlineArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetOutline,
  },
  {
    name: "get_outline_path",
    description:
      "大纲节点路径查询：返回从根到指定节点的路径 ID 列表（含 root，如 [root, vol-1, ch-3, sc-15]）。" +
      "节点不存在或已软删返回 null。",
    parameters: getOutlinePathArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetOutlinePath,
  },
  {
    name: "get_chapter_text",
    // 分页数值插值自 query/manuscript.ts 的常量（模型可见上限的唯一来源，禁止手写数字）——
    // 单源 ⇒ 改值不会静默漂移；回归断言见 index.test.ts「description 数字集合 = 两个常量」
    description:
      "章正文只读查询：按 node_id 分页读取某章正文的轻量 md 投影（服务端派生，保块级结构、弃行内样式）——" +
      "用于分析节奏、核对与设定的冲突、评价具体段落。node_id **必须是章节点**（卷/场景报错；不存在或已软删报错）。" +
      "offset 为起始字符下标（缺省 0），max_chars 为本次最多返回字符数（缺省 " +
      DEFAULT_TEXT_PAGE_CHARS +
      "、上限 " +
      MAX_TEXT_PAGE_CHARS +
      "）；" +
      "text 末尾出现「已截断」提示时，用其中给出的 offset 继续读取（长章分段读完）。" +
      "未写过正文的章返回 char_count=0、text=\"\"。" +
      "**只读**：工具面不存在任何正文写工具——正文只读、只评论、只建议，落笔由作者完成。",
    parameters: getChapterTextArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetChapterText,
  },
  {
    name: "get_deduction_marks",
    description:
      "推演节点查询（无参）：返回作者在大纲树上标定的推演边界。marks 为有序标记（index/role/node_id/" +
      "chapter_number/path/title/summary——role 与 UI 徽标文案同源）；spans 为相邻标记之间的区间骨架" +
      "（区间内中间章清单 middle、章数 chapter_count、其中已写正文的章数 written_chapters）。" +
      "语义：**单标记 = 开放式剧情发散**（唯一锚点）；**多标记 = 相邻标记之间的剧情线探讨**" +
      "（「从起点到终点这段是否成立」）。无标记或标记全部失效返回空 marks/spans（不报错）；" +
      "软删或已失效的标记不出现。AI **不能**增删推演节点——推演边界是作者的判断。",
    parameters: getDeductionMarksArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetDeductionMarks,
  },
  {
    name: "compute_state",
    description:
      "状态计算：实体（target_id）到达指定大纲节点（at_node_id）时的累积状态——" +
      "按**章序前缀**累积已确认 Delta（状态 = 初始 data + 章序 ≤ 目标进度章的全部章，跨卷/跨章；" +
      "at_node_id 不限层级：章→自身、场景→所属章、卷→该卷最后一个未软删章）。" +
      "若存在 update 冲突（from 不匹配）该 change 被跳过，" +
      "结果在 conflicts 字段标注 { field, expected, actual }，请据此向用户提示修复。",
    parameters: computeStateArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runComputeState,
  },
  {
    name: "get_delta_history",
    description:
      "Delta 历史查询：目标实体的全部属性变更记录（按时间/节点排序）。" +
      "target_type 为实体类型或 outline_node；软删相关记录自动过滤。",
    parameters: getDeltaHistoryArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetDeltaHistory,
  },
  {
    name: "get_entity_summary",
    description:
      "实体聚合统计：指定类型实体的总数与分布（character→角色分布/能力面板分组分布、hook→状态/兑现时机分布、" +
      "setting→分类分布、location→类型分布）。用于全局概览。",
    parameters: getEntitySummaryArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runGetEntitySummary,
  },
  {
    name: "search_references",
    description:
      "参考资料搜索：按关键词搜索标题+标签命中的参考资料摘要列表（type 分类可选过滤：自由文本分类，" +
      "建议沿用项目内已有分类；tags 标签 AND 过滤）。" +
      "返回摘要（content 为截断后的投影摘要，非全文；截断长度见 db toSummary）——取全文请用 get_entity 的 reference 类型。" +
      "用于 AI 不知道书里有哪些参考资料时先检索。",
    parameters: searchReferencesArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runSearchReferences,
  },
];

registerTools(queryToolDefs);

import {
  analyzeConsistencyArgsSchema,
  detectConflictsArgsSchema,
  findOrphanElementsArgsSchema,
  suggestConnectionsArgsSchema,
  tracePlotPathsArgsSchema,
} from "./schemas/index.js";
import { runAnalyzeConsistency } from "./analysis/consistency.js";
import { runDetectConflicts } from "./analysis/conflict.js";
import { runTracePlotPaths } from "./analysis/path.js";
import { runFindOrphanElements } from "./analysis/orphan.js";
import { runSuggestConnections } from "./analysis/suggest.js";

/** 分析类工具定义（S6.4，「分析类（自动）」5 个；权限全为 AUTO，长任务执行中检查 signal） */
const analysisToolDefs: ToolDefinition[] = [
  {
    name: "analyze_consistency",
    description:
      "实体档案一致性检查：检查单个实体 data 内部的矛盾（如性格反义词对并存、负年龄、" +
      "伏笔已兑现但未标注兑现节点、expected_resolve_node_id 悬空引用、location 的 parent_id 悬空引用）。" +
      "返回 issues: [{ severity: error|warning, field, description }]；实体不存在或已软删返回 null。",
    parameters: analyzeConsistencyArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runAnalyzeConsistency,
  },
  {
    name: "detect_conflicts",
    description:
      "跨实体设定矛盾检测：扫描关系图发现不一致——对称关系（ally/rival/family）单向缺失、" +
      "同一对实体互斥关系并存（ally+rival）、互相击杀（双向 kills）。" +
      "types 限定实体类型、relation_filter 限定参与检测的关系类型（缺省全量）。" +
      "返回 conflicts: [{ entity_a, entity_b, field, description }]。",
    parameters: detectConflictsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runDetectConflicts,
  },
  {
    name: "trace_plot_paths",
    description:
      "剧情路径推演：从 from_node_id 到 to_node_id 推演可能的推进路径——沿大纲树的直接链" +
      "（祖先后裔）与沿 plot_edge 剧情连线的 k 跳路径。每条路径含 nodes/description/risk_factors" +
      "（过长路径、场景缺目标、章节缺反转等风险）。节点不存在或已软删返回 null。",
    parameters: tracePlotPathsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runTracePlotPaths,
  },
  {
    name: "find_orphan_elements",
    description:
      "全项目孤立元素诊断（无参）：unused_characters（从未出场或最后活跃章早于当前最新章的角色）、" +
      "unresolved_deltas（触发节点缺失/目标端点软删或缺失的永不生效变更）、" +
      "dangling_relations（端点已物理删除的悬空关系）、" +
      "inconsistent_soft_deletes（大纲节点已软删但关联 relation/delta 未级联软删的跨存储不一致，诊断用途）。",
    parameters: findOrphanElementsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runFindOrphanElements,
  },
  {
    name: "suggest_connections",
    description:
      "潜在关系发现：为指定实体建议同类型实体的潜在关联——共同出现于同一场景（同场戏）、" +
      "共享关联实体（朋友的朋友）。返回 suggestions: [{ target_id, relation_type: ally, reason }]" +
      "（已有直接关系的候选跳过）。实体不存在或已软删返回 null。",
    parameters: suggestConnectionsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
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
} from "./schemas/index.js";
import { runAnalyzeHookHealth, runDetectHookConflicts, runFindHookOpportunities, runSuggestHookPayoff, runTraceHookLifecycle } from "./analysis/hook.js";

// 半衰期缺省映射的模型可见文案：插值自 shared `DEFAULT_HALF_LIFE`（数值单源，禁止手写数字）——
// 回归断言见 index.test.ts「半衰期映射串 = 常量五项」
const halfLifeDefaultsText = Object.entries(DEFAULT_HALF_LIFE)
  .map(([timing, chapters]) => `${timing}=${chapters}`)
  .join("/");

// 角色优先级档的模型可见文案（两处实体提案 description 共用）：档位取值 / 顺序 / 中文标签插值自
// shared `CHARACTER_PRIORITIES` / `CHARACTER_PRIORITY_LABELS`（单源，禁止在 description 里复述字面量）——
// 回归断言见 index.test.ts「角色优先级档文案 = 常量插值」
const characterPriorityText =
  "角色 priority=" +
  CHARACTER_PRIORITIES.map((key) => `${key}(${CHARACTER_PRIORITY_LABELS[key]})`).join("/") +
  "，省略或 null = 未分级";

/** 伏笔分析工具定义（S6.5，「工具扩展」+；权限全为 AUTO） */
const hookToolDefs: ToolDefinition[] = [
  {
    name: "analyze_hook_health",
    description:
      "伏笔健康总览（无参）：统计全部活跃伏笔（planted/progressing）——stale（休眠超过半衰期）、" +
      "overdue（埋设超过两倍半衰期）、blocked（依赖尚未回收）及人类可读 warnings。" +
      "返回 { current_chapter, active_count, stale, overdue, blocked_chains, warnings }；" +
      "半衰期显式 half_life 优先、缺省按 payoff_timing 映射（" + halfLifeDefaultsText + "）。",
    parameters: analyzeHookHealthArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runAnalyzeHookHealth,
  },
  {
    name: "trace_hook_lifecycle",
    description:
      "伏笔生命周期追踪：返回 hook 详情 + 埋设节点（plant，最早埋设）+ 全部推进节点（advances，按章节序）+ " +
      "回收节点（resolve，最新）+ 当前休眠章数（dormancy）+ 时间线图（timeline_graph.events 按章节序合并）。" +
      "hook 不存在或已软删返回 null。",
    parameters: traceHookLifecycleArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runTraceHookLifecycle,
  },
  {
    name: "suggest_hook_payoff",
    description:
      "伏笔回收建议：基于埋设章与半衰期（显式优先、缺省按 payoff_timing 映射）推荐理想回收**章**" +
      "（节奏匹配，取距离最近的若干章；候选为当前章节之后的未回收章；伏笔锚点仅章）。返回 { suggestions: [{ at_node, reason }] }；" +
      "hook 不存在/已软删返回 null，无埋设记录或大纲无候选章返回空建议。",
    parameters: suggestHookPayoffArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runSuggestHookPayoff,
  },
  {
    name: "find_hook_opportunities",
    description:
      "伏笔埋设机会发现：分析指定**章**节点的叙事特征（**本章及其场景**聚合：尚无伏笔埋设、角色在场数、" +
      "场景冲突层次、价值转向）建议适合的伏笔类别（mystery/relationship/world_building/character_growth）。" +
      "返回 { opportunities: [{ category, reason }] }；输入为卷/场景报错（仅章），章不存在或已软删返回 null。",
    parameters: findHookOpportunitiesArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
    run: runFindHookOpportunities,
  },
  {
    name: "detect_hook_conflicts",
    description:
      "伏笔矛盾检测（无参）：依赖循环（A↔B 互相 depends_on）、依赖已废弃（depends_on 指向 abandoned 伏笔）、" +
      "时间悖论（推进/回收节点章节早于埋设节点章节）。返回 { conflicts: [{ hook_a, hook_b, field, description }] }。",
    parameters: detectHookConflictsArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "novel",
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
  proposeCreateReferenceArgsSchema,
  proposeReorderTimepointsArgsSchema,
  proposeRemoveRelationArgsSchema,
  proposeResolveHookArgsSchema,
  proposeUpdateEntityArgsSchema,
  proposeUpdateHookArgsSchema,
} from "./schemas/index.js";
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
import { runProposeReorderTimepoints } from "./proposal/reorder-timepoints.js";
import { runProposeCreateReference } from "./proposal/reference.js";

/** 提案类工具定义（S6.6 + F9 重排 + G2 时间点重排，「提案类」+ 「工具扩展」提案类；数量以 `PROPOSAL_TOOLS` 为准；权限全为 PROPOSAL）
 * 语义：AI 不能直接修改数据——propose_* 仅产出提案（tool_result 只有 proposal_id + 一句话摘要，
 * 不含预览细节，2026-08 修订；完整预览随 tool_execution_end 帧的 result.details 推送 GUI）；用户确认后由 S7.5 路由
 * 快照重校验并调用 S6.7 执行工具落库。*/
const proposalToolDefs: ToolDefinition[] = [
  {
    name: "propose_create_entity",
    description:
      "创建实体提案：向用户提议新建实体。type 取值 character|setting|location|hook，name 必填，" +
      "data 可选（自定义字段，如角色 role/priority、伏笔 payoff_timing；" +
      characterPriorityText +
      "）。" +
      "仅生成提案（返回 proposal_id + 一句话摘要），需用户在界面确认后才生效——请勿重复提案或视为已创建。",
    parameters: proposeCreateEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeCreateEntity,
  },
  {
    name: "propose_update_entity",
    description:
      "更新实体提案：entity_id 指定实体，patches 为要修改的 data 字段（至少一项，浅合并——未传字段保留；" +
      characterPriorityText +
      "）。" +
      "仅生成提案，需用户确认后生效；确认时服务端校验实体未被他人改动（updated_at 快照比对），" +
      "实体不存在或已软删返回错误。",
    parameters: proposeUpdateEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeUpdateEntity,
  },
  {
    name: "propose_delete_entity",
    description:
      "删除实体提案：软删指定实体及其关联关系与 Delta（可回收站还原，非物理清除）。" +
      "仅生成提案，需用户确认后生效；实体不存在或已软删返回错误。",
    parameters: proposeDeleteEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeDeleteEntity,
  },
  {
    name: "propose_add_relation",
    description:
      "新增关系提案：source/target 为端点 id（实体 id 如 char-xxx，或大纲节点 id 如 ch-xxx，" +
      "类型自动识别），type 为预定义关系类型（" +
      RELATION_TYPES.join("/") +
      "，共 " +
      RELATION_TYPES.length +
      " 种；**作者在界面自定义的类型 AI 不可创建**），" +
      "metadata 可选。**伏笔三类关系（plants/advances/resolves）的源端必须是章大纲节点**" +
      "（卷/场景报错；源端为实体等反向组合同样拒绝——无消费者属数据卫生）。" +
      "仅生成提案，需用户确认后生效；端点不存在或已软删返回错误。",
    parameters: proposeAddRelationArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeAddRelation,
  },
  {
    name: "propose_remove_relation",
    description:
      "移除关系提案：relation_id 指定要移除的关系（确认后物理删除，不进回收站）。" +
      "仅生成提案，需用户确认后生效；关系不存在或端点已软删返回错误。",
    parameters: proposeRemoveRelationArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeRemoveRelation,
  },
  {
    name: "propose_add_delta",
    description:
      "追加属性变更提案：node_id 为触发变更的大纲节点（**仅章**——卷/场景拒绝），target 为变更目标（实体 id 或大纲节点 id，" +
      "类型自动识别），changes 为变更列表（op 取值 set/update/add/remove，至少一项；" +
      "update 需 from 旧值，add/remove 用 value）。**character 的不可变字段（role/description）不可作为变更字段**" +
      "（与前端字段下拉同源；请直接编辑实体）。**hook 的 status 是写路径同步的事实字段，只能用 op=set**" +
      "（用 update+from 重放会与已同步的当前值冲突，产生虚假冲突标注）。" +
      "仅生成提案，需用户确认后生效；" +
      "触发节点或目标不存在/已软删返回错误。",
    parameters: proposeAddDeltaArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeAddDelta,
  },
  {
    name: "propose_outline_node",
    description:
      "新增大纲节点提案：type 取值 volume|chapter|scene（严格三层：卷挂根、章只能挂卷、" +
      "场景必须挂章），title 必填，parent_id 指定父节点（缺省挂根——只有卷能缺省）。" +
      "仅生成提案，需用户确认后生效；父节点不存在/已软删或层级非法返回错误。",
    parameters: proposeOutlineNodeArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeOutlineNode,
  },
  {
    name: "propose_move_node",
    description:
      "移动大纲节点提案：node_id 移到 parent_id 下的 order 位置（0 起计数）。" +
      "仅生成提案，需用户确认后生效；目标父层级非法（严格三层）、" +
      "节点或父不存在/已软删返回错误。",
    parameters: proposeMoveNodeArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeMoveNode,
  },
  {
    name: "propose_delete_node",
    description:
      "删除大纲节点提案：软删指定节点及其整棵子树（可回收站还原，非物理清除）。" +
      "仅生成提案，需用户确认后生效；节点不存在或已软删返回错误。",
    parameters: proposeDeleteNodeArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeDeleteNode,
  },
  {
    name: "propose_create_hook",
    description:
      "创建伏笔提案：name 必填，data 可选（伏笔字段：payoff_timing、half_life、expected_resolve_node_id、category 等），" +
      "plant_at_node_id 可选指定埋设**章**节点（确认后建立 plants 关系）。" +
      "仅生成提案，需用户确认后生效；埋设节点非章/不存在/已软删返回错误。",
    parameters: proposeCreateHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeCreateHook,
  },
  {
    name: "propose_update_hook",
    description:
      "更新伏笔提案：hook_id 指定伏笔，patches 为要修改的 data 字段（至少一项，浅合并——未传字段保留）。" +
      "仅生成提案，需用户确认后生效；确认时服务端校验伏笔未被改动（updated_at 快照比对），" +
      "伏笔不存在或已软删返回错误。",
    parameters: proposeUpdateHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeUpdateHook,
  },
  {
    name: "propose_advance_hook",
    description:
      "推进伏笔提案：hook_id 指定伏笔，node_id 为推进发生的**章**节点，description 描述推进内容。" +
      "确认后复合写一次提交（Delta 记 status=progressing + advances 关系，幂等）。" +
      "仅生成提案，需用户确认后生效；伏笔或节点不存在/已软删/非章返回错误。",
    parameters: proposeAdvanceHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeAdvanceHook,
  },
  {
    name: "propose_resolve_hook",
    description:
      "回收伏笔提案：hook_id 指定伏笔，node_id 为回收**章**节点，description 描述回收内容。" +
      "确认后复合写一次提交（Delta 记 status=resolved + resolves 关系，幂等）。" +
      "仅生成提案，需用户确认后生效；伏笔或节点不存在/已软删/非章返回错误。",
    parameters: proposeResolveHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeResolveHook,
  },
  {
    name: "propose_abandon_hook",
    description:
      "废弃伏笔提案：hook_id 指定伏笔，description 说明废弃原因。" +
      "确认后复合写一次提交（Delta 记 status=abandoned）。" +
      "仅生成提案，需用户确认后生效；伏笔不存在或已软删返回错误。",
    parameters: proposeAbandonHookArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeAbandonHook,
  },
  {
    name: "propose_reorder_timepoints",
    description:
      "时间轴时间点重排提案（G2）：timepoint_ids 为按时间点名称（时间标签文本，如「第二天黄昏」「少年时」）" +
      "语义先后排序后的有序时间点 id **全量序列**（顺序 = 建议新序，须覆盖当前全部未软删时间点，" +
      "缺/多/重复将被拒绝）。请先查询时间点列表（search_entities type=timepoint）获取 id 与名称，" +
      "确认全部时间点后再排序；确认后服务端校验时间点快照（updated_at 比对）并按新序重排时间轴。" +
      "仅生成提案（返回 proposal_id + 一句话摘要），需用户在界面确认后才生效——请勿重复提案或视为已重排。",
    parameters: proposeReorderTimepointsArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeReorderTimepoints,
  },
  {
    name: "propose_create_reference",
    description:
      "创建参考资料提案：向用户提议把读到/总结的素材、灵感或写作要点保存为参考资料（外部素材/灵感笔记，" +
      "非本书正文）。name 标题必填，type 分类可选（自由文本，建议沿用项目内已有分类，缺省 material），" +
      "content 纯文本摘录（可含换行；按行落为段落块，不做 markdown 转换），source 来源（URL/书名/作者）可选，tags 标签数组可选。" +
      "仅生成提案（返回 proposal_id + 一句话摘要），需用户在界面确认后才写入——请勿重复提案或视为已保存。",
    parameters: proposeCreateReferenceArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    scope: "novel",
    run: runProposeCreateReference,
  },
];

registerTools(proposalToolDefs);

import { MAX_FEEDBACK_DIMENSIONS, MAX_PRACTICE_BRIEF_CHARS, MAX_PRACTICE_TOPIC_CHARS } from "@whispering233/ai-editor-shared";
import {
  freeDraftPageArgsSchema,
  practiceTextPageArgsSchema,
  styleNotesPageArgsSchema,
  submitFreeFeedbackArgsSchema,
  submitPracticeTopicArgsSchema,
  submitStyleFeedbackArgsSchema,
} from "./schemas/index.js";
import {
  runGetFreeDraft,
  runGetPracticeDraft,
  runGetPracticeSample,
  runGetStyleNotes,
  runSubmitFreeFeedback,
  runSubmitPracticeTopic,
  runSubmitStyleFeedback,
} from "./query/practice.js";

/**
 * 练习工具定义（作家文风练习（2026-10）；**仅 `kind = "practice"` 工作区注册**——`scope: "practice"`，
 * 四个只读 + 三个写 AI 产出，权限全为 AUTO）。语义：AI 能读范文、用户稿与风格说明，能写自己的产出
 * （点评卡 / 题目），**不能写用户的稿**（工具面根本没有写稿工具，结构性边界见 docs/design/60-practice.md §7）。
 * 分页数值插值自 `query/manuscript.ts` 的常量（与 get_chapter_text 同一对，模型可见上限的单源）；
 * 维度 / 题目 / 写作要求的上限插值自 shared 常量（禁止复述数字）——回归断言见 index.test.ts。
 */
const practiceToolDefs: ToolDefinition[] = [
  {
    name: "get_practice_sample",
    description:
      "范文只读查询（文风练习）：按 sample_id 分页读取练习样本的范文快照——仿写点评前用它逐字核对原文" +
      "（范文不进本轮上下文，必须自己拉取）。" +
      "offset 为起始字符下标（缺省 0），max_chars 为本次最多返回字符数（缺省 " +
      DEFAULT_TEXT_PAGE_CHARS +
      "、上限 " +
      MAX_TEXT_PAGE_CHARS +
      "）；" +
      "text 末尾出现「已截断」提示时，用其中给出的 offset 继续读取（长范文分段读完）。" +
      "返回 sample_id / work_name（关联作品名，「其他」= 未关联作品）/ excerpt_label（片段说明）" +
      " / char_count / offset / returned_chars / text / truncated。" +
      "**只读**：工具面不存在任何写工具——范文快照落库后不可变。",
    parameters: practiceTextPageArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runGetPracticeSample,
  },
  {
    name: "get_practice_draft",
    description:
      "用户仿写稿只读查询（文风练习）：按 sample_id 分页读取用户自己的仿写稿（未写稿返回 char_count=0、text=\"\"）——" +
      "点评必须基于稿件原文，不要凭作品名或片段说明下结论。" +
      "offset 为起始字符下标（缺省 0），max_chars 为本次最多返回字符数（缺省 " +
      DEFAULT_TEXT_PAGE_CHARS +
      "、上限 " +
      MAX_TEXT_PAGE_CHARS +
      "）；" +
      "text 末尾出现「已截断」提示时，用其中给出的 offset 继续读取。" +
      "返回形状与 get_practice_sample 同形（text = 用户稿）。" +
      "**只读**：工具面不存在写稿工具——用户的稿只有用户能写，你只能就它提出建议。",
    parameters: practiceTextPageArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runGetPracticeDraft,
  },
  {
    name: "get_free_draft",
    description:
      "自由练习稿只读查询（文风练习）：按 piece_id 分页读取用户自己的自由练习稿" +
      "（未写稿返回 char_count=0、text=\"\"）——点评必须基于稿件原文。" +
      "offset 为起始字符下标（缺省 0），max_chars 为本次最多返回字符数（缺省 " +
      DEFAULT_TEXT_PAGE_CHARS +
      "、上限 " +
      MAX_TEXT_PAGE_CHARS +
      "）；" +
      "text 末尾出现「已截断」提示时，用其中给出的 offset 继续读取。" +
      "返回 piece_id / char_count / offset / returned_chars / text / truncated。" +
      "**只读**：工具面不存在写稿工具。",
    parameters: freeDraftPageArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runGetFreeDraft,
  },
  {
    name: "get_style_notes",
    description:
      "作家风格说明只读查询（文风练习）：按 offset / max_chars 分页读取当前工作区作家的风格说明——" +
      "自由练习的点评依据就是它（仿写点评可按需参考，不强制引用），点评前先读它。" +
      "offset 为起始字符下标（缺省 0），max_chars 为本次最多返回字符数（缺省 " +
      DEFAULT_TEXT_PAGE_CHARS +
      "、上限 " +
      MAX_TEXT_PAGE_CHARS +
      "）；" +
      "text 末尾出现「已截断」提示时，用其中给出的 offset 继续读取。" +
      "返回 author_id / author_name / customized（是否用户自定义版本）/ char_count / offset / returned_chars / text / truncated。" +
      "**只读**：本工具只能读，无任何修改风格说明的能力。",
    parameters: styleNotesPageArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runGetStyleNotes,
  },
  {
    name: "submit_style_feedback",
    description:
      "提交仿写点评卡（文风练习，写 practice_samples.feedback）：这是本次点评的**正式产出**（不要只用聊天文字给结论）。" +
      "dimensions 最多 " +
      MAX_FEEDBACK_DIMENSIONS +
      " 个维度（超出即失败）；每项 = name 维度名 / sample_trait 范文特征 / draft_trait 你的写法 / " +
      "sample_quotes 范文原句数组 / draft_quotes 稿件原句数组 / advice 可执行建议（引用数组可省 = 无证据）。" +
      "每条引用必须能在**范文或仿写稿**里逐字找到（子串）：请照抄原文，不要改写、拼接或凭印象复述——" +
      "找不到的引用（含空串与纯空白）会被服务端丢弃并计入返回的 dropped_quotes（不阻断提交）；" +
      "所以提交前先用只读工具读到原文，引用以读到的文本为准。" +
      "summary 为可选一句话总评。卡片**没有「示范」字段**：只做诊断与建议，不代笔。" +
      "返回 { saved, dimension_count, dropped_quotes }；本工具**只写你自己的点评产出**，不改动用户稿。",
    parameters: submitStyleFeedbackArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runSubmitStyleFeedback,
  },
  {
    name: "submit_free_feedback",
    description:
      "提交自由练习点评卡（文风练习，写 practice_free_pieces.feedback）：这是本次点评的**正式产出**（不要只用聊天文字给结论）。" +
      "卡形与仿写点评卡同形（dimensions 最多 " +
      MAX_FEEDBACK_DIMENSIONS +
      " 个维度，超出即失败）；" +
      "差别在**引用校验源**：sample_quotes 必须能在**作家风格说明**里逐字找到、draft_quotes 必须能在**自由练习稿**里逐字找到" +
      "（先调 get_style_notes / get_free_draft 读原文，引用以读到的文本为准）。" +
      "找不到的引用（含空串与纯空白）会被服务端丢弃并计入返回的 dropped_quotes（不阻断提交）。" +
      "返回 { saved, dimension_count, dropped_quotes }；本工具**只写你自己的点评产出**，不改动用户稿与题目。",
    parameters: submitFreeFeedbackArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runSubmitFreeFeedback,
  },
  {
    name: "submit_practice_topic",
    description:
      "提交自由练习题目（文风练习，写 practice_free_pieces.topic / brief）：为待出题的新篇出一道练习题目。" +
      "topic 为题目（不超过 " +
      MAX_PRACTICE_TOPIC_CHARS +
      " 字），brief 为写作要求（不超过 " +
      MAX_PRACTICE_BRIEF_CHARS +
      " 字，可省）；写作要求要**可执行**（篇幅 / 人称 / 场景约束 / 要练的具体技法），不要写空话。" +
      "**该篇题目已存在时本工具会失败**（不覆盖已出的题 / 用户已开始的练习）——这时请直接点评或告知用户另建一篇。" +
      "返回 { saved, piece_id }；本工具**只写题目与写作要求**，不改动用户稿与点评卡。",
    parameters: submitPracticeTopicArgsSchema,
    permission: TOOL_PERMISSION.AUTO,
    scope: "practice",
    run: runSubmitPracticeTopic,
  },
];

registerTools(practiceToolDefs);
