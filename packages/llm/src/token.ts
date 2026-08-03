// @ai-editor/llm token 估算与工具结果截断（S6.2）
// 契约来源：
//   - doc/design/decisions.md 决策 6：chars/4 启发式 + 预算优先采用「最近一次成功响应的
//     真实 usage」，其后消息按 chars/4 估算；裁剪/重排历史后必须重置 usage 基线（旧 usage
//     描述的是裁剪前的前缀，沿用会导致预算漂移）
//   - 决策 15：工具结果截断必须带「已截断」提示——静默截断会让 LLM 基于残缺数据推理
import type { LLMMessage, LLMToolDefinition, LLMUsage } from "./types.js";

/**
 * 启发式 token 估算（决策 6：chars/4；中英文混合文本的近似，向上取整不低估）
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** 单条消息估算：content 按 chars/4；assistant 的 tool_calls 按 JSON 序列化估算 */
function estimateMessageTokens(message: LLMMessage): number {
  const contentTokens = estimateTokens(message.content ?? "");
  if (message.role === "assistant" && message.tool_calls !== undefined) {
    return contentTokens + estimateTokens(JSON.stringify(message.tool_calls));
  }
  return contentTokens;
}

/** estimateMessagesTokens 选项 */
export interface EstimateMessagesTokensOptions {
  /**
   * 最近一次成功响应的真实 usage（决策 6：作为基线优先采用）。
   * 调用方负责语义正确：裁剪/重排历史后必须重置为 null——旧 usage 描述的是裁剪前的
   * 前缀，直接沿用会导致预算漂移
   */
  lastUsage?: LLMUsage | null;
  /** 工具定义（按 JSON.stringify 估算） */
  tools?: LLMToolDefinition[];
}

/**
 * 估算消息序列 token：lastUsage.total_tokens（真实 usage 基线）
 * + 其后消息按 chars/4 估算 + 工具定义按 JSON 序列化估算
 */
export function estimateMessagesTokens(
  messages: LLMMessage[],
  options?: EstimateMessagesTokensOptions,
): number {
  const base = options?.lastUsage?.total_tokens ?? 0;
  const messagesTokens = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const toolsTokens =
    options?.tools !== undefined && options.tools.length > 0
      ? estimateTokens(JSON.stringify(options.tools))
      : 0;
  return base + messagesTokens + toolsTokens;
}

/** 工具结果截断后的形态 */
export interface TruncatedToolResult {
  /** 是否超限被截断 */
  truncated: boolean;
  /** 截断后的内容（超限时含「已截断」说明——决策 15：不得静默截断） */
  content: string;
  /** 原始字符数 */
  originalChars: number;
  /** 保留的原始字符数（不含截断说明） */
  keptChars: number;
}

/** 截断说明（提示数据不完整 + 引导缩小范围/分页——决策 15 要求 LLM 感知被截断） */
const TRUNCATION_NOTICE = "\n\n[结果已截断：超出 token 预算，数据不完整；请缩小查询范围或分页获取]";

/**
 * 工具结果按 token 预算截断（决策 15）：
 * - 未超限：原样返回（truncated=false）
 * - 超限：按 chars/4 反推可保留字符数（预留截断说明空间），拼接说明后返回——
 *   LLM 必须感知「数据被截断」才能避免基于残缺数据推理
 */
export function truncateToolResult(content: string, maxTokens: number): TruncatedToolResult {
  const originalChars = content.length;
  if (estimateTokens(content) <= maxTokens) {
    return { truncated: false, content, originalChars, keptChars: originalChars };
  }
  const maxChars = Math.max(0, Math.floor(maxTokens * 4));
  const keptChars = Math.max(0, maxChars - TRUNCATION_NOTICE.length);
  return {
    truncated: true,
    content: content.slice(0, keptChars) + TRUNCATION_NOTICE,
    originalChars,
    keptChars,
  };
}
