// @whispering233/ai-editor-llm 核心客户端（决策 34，批次九重写）
// 职责：对外提供 chatStream 流式调用（契约不变，agent/server 依赖其签名）
// 实现换核为 pi-ai（@earendil-works/pi-ai）：手写 SSE 解码（splitSSEFrames/parseSSEFrame）
// 流式 tool_call 累积（applyToolCallDelta/finalizeToolCalls）错误 body 归一化（normalizeErrorResponse）
// 原始 chunk 调试日志（summarizeStreamData）均删除——这些能力由 pi-ai 内部接管，
// 本文件变为薄封装：参数透传 + 事件转发 + abort/错误归一化委托 adapter.ts。
// 契约来源：
//   - doc/design/decisions.md 决策 34（LLM 引擎换核：adapter 单向转换保留契约）
//   - 决策 15（finish_reason=length 工具调用不执行）/ 决策 16（AbortSignal 全链路穿透）
// 调试日志：debugStream 选项语义不变（显式 true 才开——server 按 stream 类别传入；
//   原 SSE 原始行日志由 adapter 的 onResponse 摘要与日志打印替换，功能等价）
import type { LLMStreamEvent, ChatStreamResult } from "./types.js";
import { streamChat, type AdapterStreamParams } from "./adapter.js";

export { getAvailableModels, resolveModelInfo, type ModelInfo } from "./adapter.js";

/** 传输层错误码（S6.2 据此分类重试；常量保持导出，retry.ts / agent 层依赖） */
export const LLM_TRANSPORT_ERROR_CODES = {
  ABORTED: "ABORTED",
  NETWORK_ERROR: "NETWORK_ERROR",
  STREAM_TRUNCATED: "STREAM_TRUNCATED",
  NO_FETCH: "NO_FETCH",
  ENV_UNSUPPORTED: "ENV_UNSUPPORTED",
  CONSUMER_ERROR: "CONSUMER_ERROR",
} as const;

/** abort 归一化错误（决策 16 消息原文 "Request was aborted"；abort 永不重试；retry.ts 复用） */
export const ABORT_ERROR = {
  status: 0,
  code: LLM_TRANSPORT_ERROR_CODES.ABORTED,
  message: "Request was aborted",
} as const;

/** chatStream 参数（对外契约不变；实现换核后字段语义不变） */
export type ChatStreamParams = Omit<AdapterStreamParams, "onEvent"> & { onEvent?: (event: LLMStreamEvent) => void };

/**
 * 核心流式调用：调 pi-ai models.stream（内部 adapter 转换消息/事件/usage/错误）
 * 事件流：text（逐 chunk）→ tool_call（收尾时按 index 输出）→ finish（stopReason+usage）→ done
 * 错误路径：error 事件 + 结果 { ok: false, error, aborted }
 * 决策 16：signal 全链路传递（adapter 透传至 pi-ai 的 stream options signal）
 */
export async function chatStream(params: ChatStreamParams): Promise<ChatStreamResult> {
  return streamChat(params);
}

/** 兼容导出：ChatStreamParams 已重导出（见上）；保留旧 client 模块导出名（index.ts 转发不变） */
export type { AdapterStreamParams };