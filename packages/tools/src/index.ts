// @ai-editor/tools 入口：导出工具上下文 / 注册表 / 查询类工具实现
// S6.3 查询类工具（自动权限，8 个）在此注册；S6.4 分析类 / S6.5 伏笔 / S6.6 提案 /
// S6.7 执行 + executor 通过 registry.registerTool(s) 继续挂载（注册表是唯一事实来源）。
//
// 注册语义：模块副作用注册（import 即挂载）——S7.4 executor 直接 getTool(name) 调度；
// 工具定义集中在各 query 模块的 *_TOOL_DEFS 数组（name/description/argsSchema/permission/run），
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
