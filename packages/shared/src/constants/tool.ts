// AI 工具常量：分级权限 + 全量工具名
// 契约来源：doc/api/tools.md（工具分级、工具目录）、doc/database/hooks.md（伏笔分析/提案工具）

/**
 * 工具权限级别（tools.md「工具分级」两级：自动 / 提案确认）
 * 自动：直接执行，结果返回 LLM；提案确认：展示提案卡片，用户审阅确认后再执行
 */
export const TOOL_PERMISSION = {
  AUTO: "auto",
  PROPOSAL: "proposal",
} as const;

/** 工具权限级别 */
export type ToolPermission = (typeof TOOL_PERMISSION)[keyof typeof TOOL_PERMISSION];

/** 查询类工具（自动，tools.md「查询类」）：默认过滤软删对象（决策 12 修订） */
export const QUERY_TOOLS = [
  "get_entity",
  "search_entities",
  "query_relationships",
  "get_outline",
  "get_outline_path",
  "compute_state",
  "get_delta_history",
  "get_entity_summary",
] as const;

/** 分析类工具（自动，tools.md「分析类」）：结构化分析，不操作数据 */
export const ANALYSIS_TOOLS = [
  "analyze_consistency",
  "detect_conflicts",
  "trace_plot_paths",
  "find_orphan_elements",
  "suggest_connections",
] as const;

/** 伏笔分析工具（自动，hooks.md「工具扩展」分析类） */
export const HOOK_ANALYSIS_TOOLS = [
  "analyze_hook_health",
  "trace_hook_lifecycle",
  "suggest_hook_payoff",
  "find_hook_opportunities",
  "detect_hook_conflicts",
] as const;

/**
 * 提案类工具（需确认，tools.md「提案类」+ hooks.md「工具扩展」提案类，共 14 个）
 * AI 不能直接修改数据，propose_* 仅发出提案（proposal_id + 一句话摘要），
 * tool_result 不含预览细节（2026-08 修订）；完整预览经 SSE proposal 事件推送 GUI
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
] as const;

/**
 * 执行类工具（不暴露给 LLM，tools.md「执行类」，共 12 个）
 * 用户确认提案后由 Tool Executor 调用；advance_hook/resolve_hook/abandon_hook 为复合写
 * （delta_records 记 status 变化 + relation_records 插 advances/resolves，一次提交）
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
] as const;

/** 自动级工具（查询 + 分析 + 伏笔分析，共 18 个） */
export const AUTO_TOOLS = [...QUERY_TOOLS, ...ANALYSIS_TOOLS, ...HOOK_ANALYSIS_TOOLS] as const;

/** 全部工具名（自动 18 + 提案 14 + 执行 12 = 44 个） */
export const TOOL_NAMES = [...AUTO_TOOLS, ...PROPOSAL_TOOLS, ...EXECUTOR_TOOLS] as const;

/** 工具名（从 TOOL_NAMES 派生） */
export type ToolName = (typeof TOOL_NAMES)[number];
