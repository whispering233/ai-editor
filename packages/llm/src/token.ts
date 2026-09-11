// @whispering233/ai-editor-llm token 估算与工具结果截断（S6.2）
import type { LLMMessage, LLMToolDefinition, LLMUsage } from "./types.js";

/** ASCII 密度：4 字符 ≈ 1 token（英文/代码近似） */
const ASCII_CHARS_PER_TOKEN = 4;
/** 非 ASCII 密度：约 1.7 字符 ≈ 1 token（中文 ≈ 0.6 token/字，误差约 ±20%） */
const NON_ASCII_CHARS_PER_TOKEN = 1.7;

/**
 * 启发式 token 估算（分级密度：ASCII 4 字符/token；非 ASCII（中文/emoji）≈ 1.7 字符/token）。
 * 为什么分级：单一 chars/4 假设「4 字符 = 1 token」只对英文成立，中文实际约 0.6 token/字
 * ⇒ 低估约 2.4 倍，会让裁剪阈值与总闸静默失效（唯一能让护栏失灵的路径）。
 * 仍属启发式（真值以 provider usage 为准）——预算阈值用它，读数展示不用。
 */
export function estimateTokens(text: string): number {
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) nonAscii += 1;
  }
  const ascii = text.length - nonAscii;
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN);
}

/**
 * 文本的字符/token 比（把 token 预算反推为可保留字符数用）。
 * 按**文本自身**密度计算（中文与 ASCII 混排时比定值 4 准确）；空文本回退 ASCII 密度。
 */
export function charsPerToken(text: string): number {
  if (text.length === 0) return ASCII_CHARS_PER_TOKEN;
  return text.length / estimateTokens(text);
}

/** 单条消息估算：content 按分级密度（见 estimateTokens）；assistant 的 tool_calls 按 JSON 序列化估算 */
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
 * 最近一次成功响应的真实 usage 基线（作为基线优先采用）。
 * **口径**（ora S7.3 审核 S1，与 agent/run.ts toHistoryBaseline / agent/context.ts 三处
 * 等价表述）：调用方传入前必须换算为「可复用历史前缀」的真实 token 数——
 * 以 usage.prompt_tokens 为起点减 system + toolList + focus 各层估算（completion 属输出、
 * 不占 prompt_tokens，无需扣除）；若以 total_tokens 为起点则再减 completion（两式等价：
 * total - (system+toolList+focus+completion) = prompt - (system+toolList+focus)）。
 * 直接传原始 total_tokens 会与非历史层重复计费（有聚焦/工具清单后每轮恒超限，基线形同虚设）。
 * 调用方负责语义正确：裁剪/重排历史后必须重置为 null——旧 usage 描述的是裁剪前的
 * 前缀，直接沿用会导致预算漂移
 */
  lastUsage?: LLMUsage | null;
 /** 工具定义（按 JSON.stringify 估算） */
  tools?: LLMToolDefinition[];
}

/**
 * 估算消息序列 token：lastUsage.total_tokens（真实 usage 基线）
 * + 其后消息按分级密度估算（见 estimateTokens）+ 工具定义按 JSON 序列化估算
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
 /** 截断后的内容（超限时含「已截断」说明——不得静默截断） */
  content: string;
 /** 原始字符数 */
  originalChars: number;
 /** 保留的原始字符数（不含截断说明） */
  keptChars: number;
}

/** 截断说明（提示数据不完整 + 引导缩小范围/分页—— 要求 LLM 感知被截断） */
const TRUNCATION_NOTICE = "\n\n[结果已截断：超出 token 预算，数据不完整；请缩小查询范围或分页获取]";

/**
 * 工具结果按 token 预算截断：
 * - 未超限：原样返回（truncated=false）
 * - 超限：按内容自身字符/token 比反推可保留字符数（截断说明先占预算），拼接说明后返回——
 * LLM 必须感知「数据被截断」才能避免基于残缺数据推理
 */
export function truncateToolResult(content: string, maxTokens: number): TruncatedToolResult {
  const originalChars = content.length;
  if (estimateTokens(content) <= maxTokens) {
    return { truncated: false, content, originalChars, keptChars: originalChars };
  }
 // 说明先占预算（同一密度口径），再按剩余预算反推可保留字符数
  const noticeTokens = estimateTokens(TRUNCATION_NOTICE);
  const keptTokens = Math.max(0, maxTokens - noticeTokens);
  const keptChars = Math.max(0, Math.floor(keptTokens * charsPerToken(content)));
  return {
    truncated: true,
    content: content.slice(0, keptChars) + TRUNCATION_NOTICE,
    originalChars,
    keptChars,
  };
}
