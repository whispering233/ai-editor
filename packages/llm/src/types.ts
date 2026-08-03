// @ai-editor/llm 类型定义（S6.1）
// 契约来源：doc/api/endpoints.md POST /api/v1/chat、doc/design/decisions.md 决策 15/16/17/18
// DeepSeek 为 OpenAI 兼容 chat completions 格式（请求 /chat/completions，SSE 流式返回）。
// 本包只管「怎么调模型」（architecture.md 分包）：key 注入、消息序列、工具定义均由调用方提供，
// 对话组织（历史裁剪 / 成对重组）在 agent 包，重试 / token 估算在 S6.2。

// ============ 请求消息（OpenAI 兼容四角色；决策 18 消息配对约束） ============

/** 聊天消息（wire 格式；assistant 带 tool_calls 时 content 可为 null） */
export type LLMMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: LLMToolCallRequest[] }
  | { role: "tool"; content: string; tool_call_id: string };

/** assistant 消息中的工具调用（arguments 为 JSON 字符串，与流式累积格式一致） */
export interface LLMToolCallRequest {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// ============ 工具定义（function calling） ============

/** 工具定义（发送时包装为 OpenAI wire 格式 { type: "function", function }） */
export interface LLMToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 对象（OpenAI 兼容 parameters） */
  parameters: Record<string, unknown>;
}

// ============ 流式 chunk（OpenAI chat.completion.chunk） ============

/** 流式 chunk：delta 增量 + finish_reason；usage 仅部分 chunk 携带（include_usage 时在末 chunk） */
export interface LLMStreamChunk {
  id?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      /** 文本增量片段；role-only chunk 为 null */
      content?: string | null;
      /** 工具调用增量（按 index 定位，arguments 为增量片段） */
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    /** 结束原因：stop / tool_calls / length 等；未结束为 null */
    finish_reason: string | null;
  }>;
  /** 真实 token 用量（include_usage 时随末 chunk 到达；S6.2 优先采用） */
  usage?: LLMUsage | null;
}

/** token 用量（DeepSeek 返回） */
export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ============ 错误与结果 ============

/**
 * 归一化错误（S6.2 据此分类重试）
 * - 非 2xx：status = HTTP 状态码，code/message 解析自响应 body（截断）
 * - 传输层（abort / 网络断开 / 流截断）：status = 0，code 为本包错误码
 */
export interface LLMError {
  /** HTTP 状态码；传输层错误为 0 */
  status: number;
  /** 服务端错误码（如 invalid_api_key / insufficient_quota）；无则缺省 */
  code?: string;
  message: string;
}

/** 已收尾的工具调用（参数已 JSON.parse；解析失败或截断时见 error） */
export interface LLMToolCallResult {
  id: string;
  name: string;
  /** 解析成功的参数对象（失败 / 截断标记时缺省） */
  arguments?: Record<string, unknown>;
  /** 原始 arguments 字符串（诊断 / 重发用） */
  rawArguments: string;
  /** 参数解析失败或 finish_reason=length 截断的说明（决策 15） */
  error?: string;
}

// ============ 流事件与结果 ============

/** chatStream 流事件（onEvent 回调；text 逐 chunk，tool_call/finish/done 在 [DONE] 收尾时） */
export type LLMStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; toolCall: LLMToolCallResult }
  | { type: "finish"; stopReason: string; usage: LLMUsage | null }
  | { type: "error"; error: LLMError; aborted: boolean }
  | { type: "done" };

/** chatStream 完成结果（ok=false 时含归一化错误与 aborted 标记） */
export type ChatStreamResult =
  | { ok: true; stopReason: string; usage: LLMUsage | null }
  | { ok: false; aborted: boolean; error: LLMError };

// ============ 最小 Web API 结构类型 ============
// llm 包零依赖硬约束：lib 仅 ES2022、types 为空（tsconfig 不可改），
// 不引 DOM lib / @types/node。fetch / ReadableStream / TextDecoder / AbortSignal 均为
// 运行时全局（Node ≥ 18 与浏览器自带），这里只声明本包用到的字段（结构化类型）。

/** 取消信号的最小结构（决策 16：逐 chunk 检查 + 监听 abort） */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** ReadableStream reader 的最小结构 */
export interface FetchReaderLike {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
}

/** 响应体最小结构 */
export interface FetchBodyLike {
  getReader(): FetchReaderLike;
}

/** fetch 响应最小结构 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  body: FetchBodyLike | null;
  text(): Promise<string>;
}

/** fetch 请求参数最小结构 */
export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignalLike;
}

/** 可注入的 fetch 实现（默认取全局 fetch；测试注入 mock） */
export interface FetchLike {
  (input: string, init?: FetchInitLike): Promise<FetchResponseLike>;
}

/** TextDecoder 最小结构（UTF-8 流式解码） */
export interface TextDecoderLike {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
}
