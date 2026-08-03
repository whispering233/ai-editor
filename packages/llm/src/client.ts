// @ai-editor/llm 核心客户端（S6.1）
// 职责：fetch → DeepSeek（OpenAI 兼容 chat completions）流式调用——
//   手写 SSE 解码（跨 chunk data: 行拼接 / 注释行跳过 / [DONE] 哨兵 / CRLF 兼容）、
//   流式 tool_call 按 index 累积参数增量、错误归一化（{ status, code, message }）
// 契约来源：
//   - doc/api/endpoints.md「客户端解析约束」（与决策 20 同款 SSE 语义）
//   - doc/design/decisions.md 决策 15（finish_reason=length 截断的工具调用一律标记错误）、
//     决策 16（取消信号逐 chunk 检查，命中即终止并标记 aborted，消息 "Request was aborted"）
// 本包只管「怎么调模型」：key 由调用方注入（决策 17 读取优先级在 server 层实现），
// 对话组织 / 重试退避 / token 估算分别在 agent 包与 S6.2，不在本文件。
// 调试日志：AI_EDITOR_DEBUG=1 时打 [llm] stream——原始 SSE data 行摘要（需求 2 事件流形态）；
// 开关本包独立判定（isLLMDebug），不依赖 server 的 debug.ts（architecture.md 依赖方向 server → llm）。
import type {
  AbortSignalLike,
  ChatStreamResult,
  FetchLike,
  FetchResponseLike,
  LLMError,
  LLMMessage,
  LLMStreamChunk,
  LLMStreamEvent,
  LLMToolCallResult,
  LLMToolDefinition,
  LLMUsage,
  TextDecoderLike,
} from "./types.js";

/** DeepSeek API 默认 baseUrl（chat completions 路径接在其后） */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/** chat completions 端点路径（OpenAI 兼容格式） */
export const CHAT_COMPLETIONS_PATH = "/chat/completions";

/** SSE 流结束哨兵（endpoints.md 同款） */
export const SSE_DONE = "[DONE]";

/** 传输层错误码（status=0 时使用；S6.2 据此分类重试） */
export const LLM_TRANSPORT_ERROR_CODES = {
  /** 调用方取消（决策 16：永不重试） */
  ABORTED: "ABORTED",
  /** 网络断开 / fetch 抛错（S6.2 归为可重试） */
  NETWORK_ERROR: "NETWORK_ERROR",
  /** SSE 流中途终止无 [DONE]（S6.2 归为可重试） */
  STREAM_TRUNCATED: "STREAM_TRUNCATED",
  /** 环境无全局 fetch（Node < 18） */
  NO_FETCH: "NO_FETCH",
  /** 环境缺 TextDecoder（几乎不可能） */
  ENV_UNSUPPORTED: "ENV_UNSUPPORTED",
  /** 消费者 onEvent 回调自身抛错（S6.2：不可重试——不是模型/网络问题） */
  CONSUMER_ERROR: "CONSUMER_ERROR",
} as const;

/** 非 2xx 错误体读取上限（截断防超长 body） */
const MAX_ERROR_BODY_LENGTH = 2000;

/** 归一化错误 message 上限 */
const MAX_ERROR_MESSAGE_LENGTH = 200;

/** abort 归一化错误（决策 16 消息原文 "Request was aborted"；abort 永不重试；retry.ts 复用） */
export const ABORT_ERROR: LLMError = {
  status: 0,
  code: LLM_TRANSPORT_ERROR_CODES.ABORTED,
  message: "Request was aborted",
};

/** chatStream 参数 */
export interface ChatStreamParams {
  /** DeepSeek API key（决策 17：由调用方注入，本包不落盘） */
  apiKey: string;
  /** 模型名（如 "deepseek-v4-flash"；默认值定义在 server 层 settings.ts） */
  model: string;
  /** 消息序列（决策 18：assistant tool_calls 与 tool 消息须成对） */
  messages: LLMMessage[];
  /** function calling 工具定义 */
  tools?: LLMToolDefinition[];
  /** 取消信号（决策 16：逐 chunk 检查，中止即终止） */
  signal?: AbortSignalLike;
  /** 覆盖默认 baseUrl（测试 / 代理场景） */
  baseUrl?: string;
  /** max_tokens（省略则不发送） */
  maxTokens?: number;
  /** temperature（省略则不发送） */
  temperature?: number;
  /** 流事件回调：text 增量 / 完整 tool_call / finish（stop_reason+usage）/ error / done */
  onEvent?: (event: LLMStreamEvent) => void;
  /** 测试注入：默认取全局 fetch（Node 18+ / 浏览器） */
  fetchImpl?: FetchLike;
}

/** 流式 tool_call 累积缓冲（按 delta.tool_calls[].index 索引） */
export interface ToolCallBuffer {
  index: number;
  id: string;
  name: string; // function.name（首个 chunk 到达，防御性累加）
  arguments: string; // function.arguments 增量片段累积
}

/** 流状态（读循环内累积） */
export interface StreamState {
  toolCalls: ToolCallBuffer[]; // 累积中的工具调用
  usage: LLMUsage | null; // 最近一次 usage（include_usage 末 chunk）
  finishReason: string | null; // 最近一次 finish_reason
}

/**
 * 组装 chat completions 请求体（纯函数；仅含显式提供的可选字段）
 * agent 循环只用流式（YAGNI：非流式路径不做），故 stream 恒为 true
 */
export function buildChatRequestBody(input: {
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    stream: true,
    // 让末 chunk 携带真实 usage（S6.2 优先采用真实值而非估算）
    stream_options: { include_usage: true },
  };
  if (input.tools !== undefined && input.tools.length > 0) {
    // OpenAI wire 格式：工具必须包在 { type: "function", function } 内
    body.tools = input.tools.map((t) => ({ type: "function", function: t }));
  }
  if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;
  if (input.temperature !== undefined) body.temperature = input.temperature;
  return body;
}

/** 按空行（\n\n）切分 SSE 帧；输入为累积文本（调用方已归一化 CRLF），返回完整帧与剩余不完整文本 */
export function splitSSEFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf("\n\n")) !== -1) {
    frames.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  return { frames, rest };
}

/** 解析单个 SSE 帧的 data 载荷（注释行跳过、多行 data 以 \n 合并）；无 data 返回 null */
export function parseSSEFrame(frame: string): string | null {
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // 注释行（: 开头）跳过
    if (line.startsWith("data:")) {
      let value = line.slice("data:".length);
      if (value.startsWith(" ")) value = value.slice(1); // 仅剥离一个前导空格
      dataLines.push(value);
    }
    // 其他字段（event: / id: / retry:）本层不需要，忽略
  }
  return dataLines.length === 0 ? null : dataLines.join("\n");
}

/** 把单个 tool_call delta 增量并入缓冲（按 index 定位；name/arguments 均为增量片段） */
export function applyToolCallDelta(
  buffers: ToolCallBuffer[],
  delta: NonNullable<LLMStreamChunk["choices"][number]["delta"]["tool_calls"]>[number],
): ToolCallBuffer[] {
  const existing = buffers.find((b) => b.index === delta.index);
  if (existing) {
    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.name += delta.function.name;
    if (delta.function?.arguments) existing.arguments += delta.function.arguments;
    return buffers;
  }
  buffers.push({
    index: delta.index,
    id: delta.id ?? "",
    name: delta.function?.name ?? "",
    arguments: delta.function?.arguments ?? "",
  });
  return buffers;
}

/**
 * 结束收尾：按 index 升序把累积的工具调用参数 JSON.parse 为对象
 * 决策 15：finish_reason=length（max_tokens 截断）时参数可能「解析成功但静默不完整」，
 * 一律标记错误不执行，让模型重发
 * 决策 18：成对配对依赖 id（assistant.tool_calls[].id ↔ tool.tool_call_id），
 * 缺 id 的工具调用同样标记错误——DeepSeek 实际必在首 delta chunk 发送 id，
 * 此处仅防御第三方实现 / 异常流击穿 agent 层重组
 */
export function finalizeToolCalls(buffers: ToolCallBuffer[], stopReason: string): LLMToolCallResult[] {
  const truncated = stopReason === "length";
  return buffers
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((b) => {
      const base: LLMToolCallResult = { id: b.id, name: b.name, rawArguments: b.arguments };
      if (truncated) {
        return { ...base, error: "finish_reason=length：参数可能不完整，不执行（决策 15）" };
      }
      if (!b.id) {
        return { ...base, error: "工具调用缺 id，无法执行（决策 18 配对依赖 id）" };
      }
      try {
        const parsed: unknown = JSON.parse(b.arguments || "{}");
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("arguments 非 JSON 对象");
        }
        return { ...base, arguments: parsed as Record<string, unknown> };
      } catch {
        return { ...base, error: "参数 JSON 解析失败" };
      }
    });
}

/** 处理单个 chunk：文本增量发 text 事件、tool_call 增量入缓冲、记录 usage / finish_reason */
export function applyStreamChunk(
  state: StreamState,
  chunk: LLMStreamChunk,
  emit: (event: LLMStreamEvent) => void,
): void {
  if (chunk.usage) state.usage = chunk.usage; // 部分 chunk 携带 usage（include_usage 末 chunk）
  const choice = chunk.choices[0];
  if (!choice) return; // 纯 usage chunk（choices 为空数组）
  if (choice.finish_reason) state.finishReason = choice.finish_reason;
  const delta = choice.delta ?? {};
  if (typeof delta.content === "string" && delta.content !== "") {
    emit({ type: "text", delta: delta.content }); // 文本增量逐 chunk 转发
  }
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) applyToolCallDelta(state.toolCalls, tc);
  }
}

/**
 * 非 2xx 响应 → 归一化错误（读 body 截断；解析 error.message / error.code；
 * body 非 JSON 时 message 走 "HTTP <status> <statusText>" 兜底）
 */
export async function normalizeErrorResponse(res: FetchResponseLike): Promise<LLMError> {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    // 读 body 失败（连接中断等）：message 走兜底
  }
  if (raw.length > MAX_ERROR_BODY_LENGTH) raw = raw.slice(0, MAX_ERROR_BODY_LENGTH);
  let code: string | undefined;
  let message: string | undefined;
  try {
    const json = JSON.parse(raw) as {
      error?: { code?: unknown; message?: unknown };
      code?: unknown;
      message?: unknown;
    };
    const err = json.error ?? json;
    if (typeof err.code === "string") code = err.code;
    if (typeof err.message === "string") message = err.message;
  } catch {
    // body 非 JSON（网关 HTML 等）：message 走兜底
  }
  const fallback = `HTTP ${res.status} ${res.statusText}`.trim();
  return {
    status: res.status,
    ...(code !== undefined ? { code } : {}),
    message: (message || fallback).slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}

/** 把 data 载荷解析为 chunk（JSON.parse + 最小形状兜底；非法 → null 跳过容错） */
function parseChunk(data: string): LLMStreamChunk | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { choices?: unknown }).choices)) {
      return null;
    }
    return parsed as LLMStreamChunk;
  } catch {
    return null;
  }
}

// ============ [llm] stream 调试日志（AI_EDITOR_DEBUG=1，原始 SSE 流） ============
// 与 server 的 debug.ts 同开关语义（AI_EDITOR_DEBUG === "1"），但**本包独立判定**——
// llm 不依赖 server（architecture.md 依赖方向 server → llm），client.ts 内部直接读环境变量。
// 输出走 console.debug（stderr 通道，与 server [chat]/[llm] 日志同通道，shell 统一过滤）。
// 需求 2：debug 态查看 DeepSeek 返回的原始 chunk 序列（data 行摘要 + [DONE]）。

/** 调试开关环境变量名（与 server DEBUG_ENV_NAME 同值；本包自持常量，避免跨包 import） */
const LLM_DEBUG_ENV_NAME = "AI_EDITOR_DEBUG";

/** [llm] stream 摘要：delta 片段（content / tool_call 参数）截断上限（防刷屏） */
const LLM_STREAM_DELTA_MAX = 120;

/**
 * 调试开关判定：globalThis.process 探测——本包零依赖硬约束（tsconfig lib 仅 ES2022、
 * types 为空，无 @types/node / DOM lib），Node ≥ 18 与浏览器下均可安全访问，缺 process 返回关闭。
 */
export function isLLMDebug(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[LLM_DEBUG_ENV_NAME] === "1";
}

/** 调试输出（console.debug 探测调用——同上的零依赖约束；调用时取值，测试 vi.spyOn 可拦截） */
function debugConsole(...args: unknown[]): void {
  (globalThis as unknown as { console?: { debug?: (...a: unknown[]) => void } }).console?.debug?.(...args);
}

/** 摘要截断：超长截断并标注原长（如 "你好…(500 字符)"），可读性优先；非字符串兜底 JSON 序列化（防御畸形 chunk） */
function truncateDebugField(value: unknown, max: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
  return text.length > max ? `${text.slice(0, max)}…(${text.length} 字符)` : text;
}

/**
 * 原始 SSE data 行 → [llm] stream 摘要（每帧一行，展示事件流形态）：
 * - [DONE] 哨兵：原样 "[DONE]"
 * - 普通 chunk：`#序号 delta={role=… content="…" tool_call#i id=… name=… args=…} finish=<reason|null>`
 *   关键字段**完整保留**：chunk 序号 / role / tool_call index / finish_reason；
 *   content 与 tool_call 参数为增量片段，截断（120 字符 + 原长标注，防刷屏）——
 *   delta 摘要本身就是流式片段，截断只丢片段尾部、不丢结构
 * - usage 出现即完整打印（字段短、信息密度高，需求 3 的流内真实用量）
 * - data 非 JSON（防御路径）：原文截断摘要
 */
export function summarizeStreamData(data: string, seq: number): string {
  if (data === SSE_DONE) return "[DONE]";
  const chunk = parseChunk(data);
  if (chunk === null) return `#${seq} <解析失败> ${truncateDebugField(data, LLM_STREAM_DELTA_MAX)}`;
  const parts: string[] = [];
  const choice = chunk.choices[0];
  const delta = choice?.delta;
  if (delta !== undefined) {
    if (delta.role !== undefined) parts.push(`role=${delta.role}`);
    if (typeof delta.content === "string" && delta.content !== "") {
      parts.push(`content=${JSON.stringify(truncateDebugField(delta.content, LLM_STREAM_DELTA_MAX))}`);
    }
    if (delta.tool_calls !== undefined) {
      for (const tc of delta.tool_calls) {
        const fn = tc.function;
        const frag = [
          `tool_call#${tc.index}`,
          ...(tc.id ? [`id=${tc.id}`] : []),
          ...(fn?.name ? [`name=${fn.name}`] : []),
          // arguments 本身是 JSON 字符串，截断后原样输出（不再包引号，保持可读）
          ...(fn?.arguments ? [`args=${truncateDebugField(fn.arguments, LLM_STREAM_DELTA_MAX)}`] : []),
        ];
        parts.push(frag.join(" "));
      }
    }
  }
  let line = `#${seq} delta={${parts.join(" ")}} finish=${choice?.finish_reason ?? "null"}`;
  if (chunk.usage) line += ` usage=${JSON.stringify(chunk.usage)}`; // usage 完整打印（字段短、信息密度高）
  return line;
}

/** 惰性获取全局 TextDecoder（Node 18+ / 浏览器自带）；缺失返回 null（几乎不可能） */
function loadTextDecoder(): TextDecoderLike | null {
  const ctor = (globalThis as unknown as { TextDecoder?: new () => TextDecoderLike }).TextDecoder;
  return ctor ? new ctor() : null;
}

/**
 * 核心流式调用：fetch → DeepSeek chat completions（SSE），逐事件回调，返回完成结果
 * - 事件流：text（逐 chunk 增量）→ … → tool_call（收尾时按 index 输出）→ finish（stop_reason+usage）→ done
 * - 错误路径：error 事件 + 结果 { ok: false, error, aborted }（abort / 网络 / 截断 / 非 2xx）
 * - 决策 16：逐 chunk 检查 signal.aborted，命中即终止；挂起 read 也通过 abort 监听 cancel 立即唤醒
 * - 流中途终止无 [DONE] 哨兵 = STREAM_TRUNCATED 错误，不静默
 */
export async function chatStream(params: ChatStreamParams): Promise<ChatStreamResult> {
  const {
    apiKey,
    model,
    messages,
    tools,
    signal,
    baseUrl = DEEPSEEK_BASE_URL,
    maxTokens,
    temperature,
    onEvent,
  } = params;

  // —— 消费者异常状态（安全 emit 用）：onEvent 抛错 → 转 CONSUMER_ERROR 并终止流 ——
  let consumerError: LLMError | null = null;

  /**
   * 安全 emit：消费者 onEvent 抛错不逃逸——
   * 否则读循环的 catch 会把消费者 bug 误归为 NETWORK_ERROR（S6.2 会误重试），
   * EOF flush 块（try 之外）则会直接 reject Promise，违反「不 throw、只走 result」契约。
   * 处理：转为本层 error 事件（不吞掉原始错误信息）+ 后续事件抑制 + 流终止
   */
  const emit = (event: LLMStreamEvent) => {
    if (consumerError !== null) return; // 消费者已抛错：后续事件抑制
    try {
      onEvent?.(event);
    } catch (err) {
      consumerError = {
        status: 0,
        code: LLM_TRANSPORT_ERROR_CODES.CONSUMER_ERROR,
        message: `消费者事件回调抛错：${err instanceof Error ? err.message : String(err)}`,
      };
      try {
        onEvent?.({ type: "error", error: consumerError, aborted: false });
      } catch {
        // 消费者连 error 事件都无法处理：放弃通知（原始错误信息已保留在 consumerError）
      }
    }
  };

  // —— abort 终止（决策 16：命中取消信号即终止，标记 aborted）——
  const abortNow = (): ChatStreamResult => {
    emit({ type: "error", error: ABORT_ERROR, aborted: true });
    return { ok: false, aborted: true, error: ABORT_ERROR };
  };

  /** 消费者异常终止：结果如实反映失败（S6.2：CONSUMER_ERROR 不可重试） */
  const consumerFailResult = (): ChatStreamResult => {
    const error: LLMError = consumerError ?? {
      status: 0,
      code: LLM_TRANSPORT_ERROR_CODES.CONSUMER_ERROR,
      message: "消费者事件回调抛错",
    };
    return { ok: false, aborted: false, error };
  };

  // abort 已触发：不发起请求，直接返回（决策 16 四层穿透的读循环层）
  if (signal?.aborted) return abortNow();

  const fetchImpl = params.fetchImpl ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) {
    const error: LLMError = { status: 0, code: LLM_TRANSPORT_ERROR_CODES.NO_FETCH, message: "当前环境无全局 fetch（Node ≥ 18 / 浏览器）" };
    emit({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  }

  let res: FetchResponseLike;
  try {
    res = await fetchImpl(`${baseUrl}${CHAT_COMPLETIONS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      body: JSON.stringify(buildChatRequestBody({ model, messages, tools, maxTokens, temperature })),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    // fetch 抛错：abort（AbortError / 信号已置位）或网络错误（决策 15 分类：网络断开可重试）
    const aborted = signal?.aborted === true || (err instanceof Error && err.name === "AbortError");
    const error: LLMError = aborted
      ? { ...ABORT_ERROR }
      : { status: 0, code: LLM_TRANSPORT_ERROR_CODES.NETWORK_ERROR, message: err instanceof Error ? err.message : String(err) };
    emit({ type: "error", error, aborted });
    return { ok: false, aborted, error };
  }

  // 非 2xx：读 body（截断）归一化为结构化错误（S6.2 据此分类重试）
  if (!res.ok) {
    // 读错误 body 前后检查 abort：已取消的请求不得按 429/5xx 归类（否则 S6.2 会误重试）
    if (signal?.aborted) return abortNow();
    const error = await normalizeErrorResponse(res);
    if (signal?.aborted) return abortNow();
    emit({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  }
  if (!res.body) {
    const error: LLMError = { status: 0, code: LLM_TRANSPORT_ERROR_CODES.STREAM_TRUNCATED, message: "响应无 body（SSE 流缺失）" };
    emit({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  }

  const decoder = loadTextDecoder();
  if (!decoder) {
    const error: LLMError = { status: 0, code: LLM_TRANSPORT_ERROR_CODES.ENV_UNSUPPORTED, message: "当前环境缺少 TextDecoder（需要 Node ≥ 18 或浏览器）" };
    emit({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  }

  // —— 正常收尾（已见 [DONE]）：tool_call 收尾 parse + finish + done ——
  const finalize = (state: StreamState): ChatStreamResult => {
    const stopReason = state.finishReason ?? "stop"; // 防御缺省（正常流必有 finish_reason）
    for (const tc of finalizeToolCalls(state.toolCalls, stopReason)) {
      emit({ type: "tool_call", toolCall: tc }); // 决策 15：length 截断的工具调用一律标记错误
    }
    emit({ type: "finish", stopReason, usage: state.usage });
    emit({ type: "done" });
    if (consumerError !== null) return consumerFailResult(); // 消费者已坏：结果如实反映失败
    return { ok: true, stopReason, usage: state.usage };
  };

  const reader = res.body.getReader();
  const onAbort = () => {
    // 底层 fetch 未随 signal 中止时（mock / 部分实现），cancel 使挂起的 read 立即返回
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const state: StreamState = { toolCalls: [], usage: null, finishReason: null };
  let buffer = "";

  // [llm] 原始 SSE data 行逐帧日志（AI_EDITOR_DEBUG=1；关闭时零开销早退——高频路径无条件
  // 调用，成本控制在本层内部，与 server debug.ts 同模式）
  let streamSeq = 0;
  const logStreamData = (data: string): void => {
    if (!isLLMDebug()) return;
    streamSeq += 1;
    debugConsole(`[llm] stream ${summarizeStreamData(data, streamSeq)}`);
  };

  try {
    while (true) {
      if (signal?.aborted) return abortNow();
      const { done, value } = await reader.read();
      if (signal?.aborted) return abortNow(); // read 挂起期间被 abort（cancel / 底层拒绝）
      if (done) break; // EOF：期望 [DONE]，见下方收尾校验
      // 追加解码 + CRLF 归一化（\r 可能跨 chunk 分片，整 buffer 归一化最稳）
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const { frames, rest } = splitSSEFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const data = parseSSEFrame(frame);
        if (data === null) continue; // 注释帧 / 无 data 帧
        logStreamData(data); // [llm] stream 原始 data 行（AI_EDITOR_DEBUG=1；关闭零开销）
        if (data === SSE_DONE) return finalize(state); // 哨兵：正常结束
        const chunk = parseChunk(data);
        if (chunk) {
          applyStreamChunk(state, chunk, emit); // 非法 chunk 跳过容错
          if (consumerError !== null) return consumerFailResult(); // 消费者异常：立即终止
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) return abortNow();
    const error: LLMError = {
      status: 0,
      code: LLM_TRANSPORT_ERROR_CODES.NETWORK_ERROR,
      message: err instanceof Error ? err.message : String(err),
    };
    emit({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  // EOF 未收到 [DONE]：先 flush 残余帧（服务端可能省略结尾空行），再判定截断
  if (buffer.trim() !== "") {
    const data = parseSSEFrame(buffer.trim());
    if (data !== null) logStreamData(data); // [llm] stream（EOF 残余帧同样逐帧）
    if (data === SSE_DONE) return finalize(state);
    if (data !== null) {
      const chunk = parseChunk(data);
      if (chunk) {
        applyStreamChunk(state, chunk, emit);
        if (consumerError !== null) return consumerFailResult();
      }
    }
  }
  // 流中途终止无 [DONE] = 错误（网络断开 / 截断，不静默）
  const error: LLMError = {
    status: 0,
    code: LLM_TRANSPORT_ERROR_CODES.STREAM_TRUNCATED,
    message: "SSE 流中途终止，未收到 [DONE] 哨兵",
  };
  emit({ type: "error", error, aborted: false });
  return { ok: false, aborted: false, error };
}
