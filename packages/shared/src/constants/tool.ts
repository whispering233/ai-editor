// AI 工具常量：分级权限 + 工作区作用域 + 全量工具名

import type { WorkspaceKind } from "./workspace.js";

/**
 * 工具权限级别（「工具分级」两级：自动 / 提案确认）
 * 自动：直接执行，结果返回 LLM；提案确认：展示提案卡片，用户审阅确认后再执行
 */
export const TOOL_PERMISSION = {
  AUTO: "auto",
  PROPOSAL: "proposal",
} as const;

/** 工具权限级别 */
export type ToolPermission = (typeof TOOL_PERMISSION)[keyof typeof TOOL_PERMISSION];

/**
 * 工具作用域（2026-10）：工具归哪个工作区类型可用——`novel` / `practice` 为各自专属，
 * `common` = 两种工作区都注册。装配层按当前工作区 `kind` 过滤（见 `isToolScopeRegistered`），
 * 语义与不变式见 `docs/design/architecture.md`「工作区类型（kind）与能力收窄」。
 */
export const TOOL_SCOPES = ["novel", "practice", "common"] as const;

/** 工具作用域 */
export type ToolScope = (typeof TOOL_SCOPES)[number];

/**
 * 工作区类型 → 允许注册的工具 `scope` 集合（**唯一定义处**）：装配层只经
 * `isToolScopeRegistered` 判定，任何消费方（agent / tools / server）不得复写这份映射。
 * 不变式：非小说工作区不注册小说工具与提案工具（结构性边界，靠注册过滤，不靠提示词）。
 */
export const WORKSPACE_TOOL_SCOPES: Record<WorkspaceKind, readonly ToolScope[]> = {
  novel: ["novel", "common"],
  practice: ["practice", "common"],
};

/**
 * 该 `scope` 的工具在指定工作区是否注册——**装配层唯一判定入口**。
 * 未知 `kind`（类型层之外的值，如漏传参数）直接抛错：**不退化为「注册全量」**，
 * 否则收窄会静默失效（工具集按 kind 收窄是结构性边界）。
 */
export function isToolScopeRegistered(kind: WorkspaceKind, scope: ToolScope): boolean {
  const allowed: readonly ToolScope[] | undefined = WORKSPACE_TOOL_SCOPES[kind];
  if (allowed === undefined) {
    throw new Error(`未知工作区类型: ${String(kind)}`);
  }
  return allowed.includes(scope);
}

/** 查询类工具（自动，「查询类」）：默认过滤软删对象 */
export const QUERY_TOOLS = [
  "get_entity",
  "search_entities",
  "search_references", // 参考资料搜索（自动权限）
  "query_relationships",
  "get_outline",
  "get_outline_path",
  "get_deduction_marks", // 推演节点标记（剧情推演）
  "get_chapter_text", // 章正文只读（卡 12.9：分页拉取 content_text 投影）
  "compute_state",
  "get_delta_history",
  "get_entity_summary",
] as const;

/** 分析类工具（自动，「分析类」）：结构化分析，不操作数据 */
export const ANALYSIS_TOOLS = [
  "analyze_consistency",
  "detect_conflicts",
  "trace_plot_paths",
  "find_orphan_elements",
  "suggest_connections",
] as const;

/** 伏笔分析工具（自动，「工具扩展」分析类） */
export const HOOK_ANALYSIS_TOOLS = [
  "analyze_hook_health",
  "trace_hook_lifecycle",
  "suggest_hook_payoff",
  "find_hook_opportunities",
  "detect_hook_conflicts",
] as const;

/**
 * 提案类工具（需确认，「提案类」+ 「工具扩展」提案类，共 16 个）
 * AI 不能直接修改数据，propose_* 仅发出提案（proposal_id + 一句话摘要），
 * tool_result 不含预览细节；完整预览随 tool_execution_end 帧的 result.details 推送 GUI
 */
export const PROPOSAL_TOOLS = [
  "propose_create_entity",
  "propose_update_entity",
  "propose_delete_entity",
  "propose_add_relation",
  "propose_remove_relation",
  "propose_add_delta",
  "propose_outline_node",
  "propose_move_node",
  "propose_delete_node",
  "propose_create_hook",
  "propose_update_hook",
  "propose_advance_hook",
  "propose_resolve_hook",
  "propose_abandon_hook",
  "propose_reorder_timepoints", // G2（注记）：LLM 按时间点 name（时间标签）语义排序 → 提案确认
  "propose_create_reference", //：AI 建议保存参考资料（外部素材/灵感笔记）
] as const;

/**
 * 执行类工具（不暴露给 LLM，「执行类」，共 13 个）
 * 用户确认提案后由 Tool Executor 调用；advance_hook/resolve_hook/abandon_hook 为复合写
 * （delta_records 记 status 变化 + relation_records 插 advances/resolves，一次提交）；
 * reorder_timepoints 为批量重排（G2：按新序事务内重写 sort_order 0..n-1，取代 F9 reorder_events）
 */
export const EXECUTOR_TOOLS = [
  "create_entity",
  "update_entity",
  "delete_entity",
  "add_relation",
  "remove_relation",
  "add_delta",
  "create_outline_node",
  "move_node",
  "delete_node",
  "advance_hook",
  "resolve_hook",
  "abandon_hook",
  "reorder_timepoints",
] as const;

/** 自动级工具（查询 11 + 分析 5 + 伏笔分析 5，共 21 个） */
export const AUTO_TOOLS = [...QUERY_TOOLS, ...ANALYSIS_TOOLS, ...HOOK_ANALYSIS_TOOLS] as const;

/**
 * 通用工具（自动级，`scope = "common"`，共 2 个）：**两种工作区都注册**——
 * 外部检索 `web_search` 与网页抓取 `fetch_content`（联网能力，与工作区语义无关，
 * 见 docs/api/tool-calling.md「外部检索（自动）」）。
 */
export const COMMON_TOOLS = [
  "web_search", // DeepSeek 联网检索（只读、无提案；凭据由 server 注入）
  "fetch_content", // DeepSeek 网页抓取（只读、无缓存；先搜索后抓取）
] as const;

/**
 * 练习工具（自动级，「作家文风练习」，共 7 个 = 四只读 + 三写 AI 自己的产出）——
 * **仅 `kind = "practice"` 工作区注册**（`scope = "practice"`，见 docs/api/tool-calling.md「按工作区类型收窄」）：
 * 四个只读分页工具（范文 / 仿写稿 / 自由稿 / 风格说明）与三个提交工具（仿写点评卡 / 自由练习点评卡 / 出题）。
 * 工具面**不存在任何写用户稿的工具**——用户的稿只有用户能写（结构性边界）。
 */
export const PRACTICE_TOOLS = [
  "get_practice_sample", // 范文快照只读（分页）
  "get_practice_draft", // 用户仿写稿只读（分页）
  "get_free_draft", // 用户自由练习稿只读（分页）
  "get_style_notes", // 作家风格说明只读（分页；自由练习点评的唯一依据）
  "submit_style_feedback", // 提交仿写点评卡（只写 practice_samples.feedback）
  "submit_free_feedback", // 提交自由练习点评卡（只写 practice_free_pieces.feedback）
  "submit_practice_topic", // AI 出题（只写 practice_free_pieces.topic / brief）
] as const;

/** 全部工具名（自动 21 + 通用 2 + 练习 7 + 提案 16 + 执行 13 = 59 个） */
export const TOOL_NAMES = [
  ...AUTO_TOOLS,
  ...COMMON_TOOLS,
  ...PRACTICE_TOOLS,
  ...PROPOSAL_TOOLS,
  ...EXECUTOR_TOOLS,
] as const;

/** 工具名（从 TOOL_NAMES 派生） */
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * `details` **随 SSE 帧下发**的工具（提案工具之外的部分）——**唯一定义处**（2026-10）。
 * 契约 = docs/api/80-api-chat.md「过滤约定」：AUTO 工具的 `details` 一般不下发（与 `content` 重复、可能极大），
 * 例外只给「details 是前端真实数据面」的工具；提案工具的 details（提案载荷）不在本集合里，
 * 由 `PROPOSAL_TOOLS` 单独表达（投影层按两者并集放行，见 agent 包 `runtime/events.ts`）。
 */
export const TOOL_DETAILS_TO_CLIENT = [
  // 点评卡：写库结果随帧下发，前端据此即时刷新卡片（卡片正体从 GET /practice/samples/:id 读）
  "submit_style_feedback",
  // 自由练习点评 / 出题：同上（写库结果随帧下发；前端据 `tool_execution_start` 的入参 piece_id 认领）
  "submit_free_feedback",
  "submit_practice_topic",
] as const satisfies readonly ToolName[];
