// @whispering233/ai-editor-llm pi-ai 适配层（决策 34，批次九）
// 职责：把 ai-editor 的 LLMMessage[]（OpenAI wire 格式）转换为 pi-ai 的 Context 消息，
// 调用 pi-ai 的 models.stream 并把其事件转发为 ai-editor 的 LLMStreamEvent 事件流，
// 完成 usage/错误/工具 schema 的转换——这是把手写 SSE 解码/流式 tool_call 累积/
// 错误 body 归一化（旧 client.ts 约 300 行）替换为声明式单点适配的核心文件。
//
// 设计要点（决策 34）：
// - 单向有界转换：DB 行 → pi-ai Context 只在此一处构建；出站是纯事件转发
//   （text_delta→text / toolcall_end→tool_call / done→finish+done / error→error）
// - 事件映射：pi-ai 的 thinking_* 事件忽略不转发（YAGNI：MVP 不展示思考过程）
// - 错误归一化：openai-completions 用官方 openai SDK，normalizeProviderError 会把
//   HTTP status + body JSON 折入 errorMessage（格式 "429: {..}" / "(429): {..}"）；
//   适配层在流开始时经 onResponse 记录真实 status + 解析 errorMessage 中的 code 关键词
//   恢复 LLMError.status/code——classifyLLMError（决策 15 分类语义）原逻辑不变
// - 工具 schema：LLMToolDefinition.parameters 是 JSON Schema 对象，pi-ai 的 Tool.parameters
//   是 TypeBox TSchema 但发送层直接透传（parameters as any）；原样映射 + 类型断言；
//   validateToolCall 不调用（ai-editor 的 executor 自己用 zod 校验，决策 14 语义不变）
// - key 管理：apiKey 随 chatStream.params 传入（经 stream options 的 apiKey 字段注入，
//   applyAuth 的 options.apiKey 优先于 provider 的 env 解析——决策 17 语义不变）
import { createModels, type Model, type Context, type Tool, type Usage as PiUsage, type Message } from "@earendil-works/pi-ai";
import type { TSchema } from "@earendil-works/pi-ai"; // pi-ai 从 typebox 转发导出
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
  LLMMessage,
  LLMToolDefinition,
  LLMStreamEvent,
  LLMError,
  LLMUsage,
  LLMToolCallResult,
  ChatStreamResult,
  AbortSignalLike,
} from "./types.js";
import { LLM_TRANSPORT_ERROR_CODES } from "./client.js";

// ============ models 集合（单例：只注册 deepseek provider，tree-shaking 友好） ============

let modelsCache: ReturnType<typeof createModels> | null = null;
let modelsGetter: () => ReturnType<typeof createModels> = () => {
  if (modelsCache === null) {
    modelsCache = createModels();
    modelsCache.setProvider(deepseekProvider());
  }
  return modelsCache;
};

/** 获取 models 集合（懒初始化注册 deepseek provider 内置模型目录） */
export function getModels(): ReturnType<typeof createModels> {
  return modelsGetter();
}

/** 测试注入 models 集合（替换单例行为，不联网） */
export function _setModels(getter: () => ReturnType<typeof createModels>): void {
  modelsGetter = getter;
  modelsCache = null;
}

/** 可注入的模型查找函数（测试替换用；缺省从单例集合取） */
export type ModelLookup = (providerId: string, modelId: string) => Model<string> | undefined;

let modelLookup: ModelLookup = (providerId, modelId) => getModels().getModel(providerId, modelId);

/** 测试注入模型查找函数（替换单例行为，不联网） */
export function _setModelLookup(fn: ModelLookup): void {
  modelLookup = fn;
  modelsCache = null;
}

// ============ 工具转换（LLMToolDefinition → pi-ai Tool，透传 parameters） ============

/** 工具定义转换：JSON Schema 对象原样透传（pi-ai 发送层 as any 直接序列化，已确认） */
export function toPiTools(defs: readonly LLMToolDefinition[] = []): Tool[] {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.parameters as unknown as TSchema, // TypeBox TSchema 运行时即 JSON Schema 兼容对象
  }));
}

// ============ 消息转换（LLMMessage[] → pi-ai Context，单向有界） ============

/** 默认模型元数据（assistant 消息回填用；DeepSeek 兼容 OpenAI 格式） */
const FALLBACK_MODEL = "deepseek-v4-flash";
const FALLBACK_PROVIDER = "deepseek";

/** 空 usage 兜底（AssistantMessage 必需字段；真实 usage 由完成消息带回） */
function emptyPiUsage(): PiUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

/** 将 LLMMessage[] 组装为 pi-ai Context（system 提取为 systemPrompt，其余映射为 messages）
 * 注：LLM 工具调用成对性（决策 18 修订）由上层（agent/session.ts）保证——本层不做配对校验（防御性
 * 由 run.ts 前置条件约束） */
export function buildPiContext(messages: readonly LLMMessage[], tools: readonly LLMToolDefinition[]): Context {
  const systemPrompt = messages.find((m) => m.role === "system")?.content;
  const nonSystem = messages.filter((m) => m.role !== "system");
  // 维护 tool_call_id → toolName 映射（assistant 的 tool_calls 在 tool 消息之前到达）
  const toolNameById = new Map<string, string>();
  const piMessages = nonSystem.map((m): Message => {
    switch (m.role) {
      case "user":
        return { role: "user" as const, content: m.content, timestamp: Date.now() } as const;
      case "assistant": {
        const blocks: Array<{ type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }> = [];
        if (m.content !== null && m.content !== "") {
          blocks.push({ type: "text", text: m.content });
        }
        if (m.tool_calls !== undefined) {
          for (const tc of m.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              const parsed: unknown = JSON.parse(tc.function.arguments);
              if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
            } catch {
              args = {}; // 参数 JSON 解析失败：空对象（防御，不阻断对话）
            }
            toolNameById.set(tc.id, tc.function.name);
            blocks.push({ type: "toolCall", id: tc.id, name: tc.function.name, arguments: args });
          }
        }
        return {
          role: "assistant" as const,
          content: blocks,
          api: "openai-completions" as const,
          provider: FALLBACK_PROVIDER,
          model: FALLBACK_MODEL,
          usage: emptyPiUsage(),
          stopReason: "toolUse" as const, // 历史消息重放时的不精确占位（协议需要 stopReason 字段）
          timestamp: Date.now(),
        };
      }
      case "tool": {
        const toolName = toolNameById.get(m.tool_call_id) ?? "";
        return {
          role: "toolResult" as const,
          toolCallId: m.tool_call_id,
          toolName,
          content: [{ type: "text" as const, text: m.content }],
          isError: false, // ai-editor 的 tool 消息不区分错误（错误已回执在 content 内）
          timestamp: Date.now(),
        };
      }
    }
  });
  return { systemPrompt, messages: piMessages, tools: toPiTools(tools) };
}

// ============ usage 转换（pi-ai Usage → LLMUsage，口径对齐 DeepSeek 原生字段） ============

/** usage 转换：pi-ai 的 input 不含缓存（input = prompt - cacheRead - cacheWrite）
 * → LLMUsage.prompt_tokens = input + cacheRead + cacheWrite = totalTokens - output */
export function convertUsage(usage: PiUsage | undefined): LLMUsage | null {
  if (usage === undefined) return null;
  return {
    prompt_tokens: usage.input + usage.cacheRead + usage.cacheWrite,
    completion_tokens: usage.output,
    total_tokens: usage.totalTokens,
  };
}

// ============ 错误归一化（pi-ai error → LLMError + status/code 恢复） ============

/** 从 pi-ai errorMessage 中提取 HTTP status（格式 "429: {...}" 或 "(429): {...}" 前缀） */
export function extractStatusFromMessage(message: string): number | undefined {
  const m = /(?:^|\s)\(?(\d{3})\)?[\s:]/.exec(message);
  if (m === null) return undefined;
  const status = Number(m[1]);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/** 从 errorMessage 中提取服务端错误码关键词（insufficient_quota 等，决策 15 分类依赖） */
export function extractCodeFromMessage(message: string): string | undefined {
  const QUOTA_KEYWORDS = ["insufficient_quota", "billing", "quota", "rate limit", "rate_limit", "invalid_api_key", "authentication"];
  const lower = message.toLowerCase();
  for (const kw of QUOTA_KEYWORDS) {
    if (lower.includes(kw)) return kw.replace(/ /g, "_"); // 规范化下划线形态（rate limit → rate_limit）
  }
  return undefined;
}

/** 归一化 pi-ai 错误为 LLMError（status/code 恢复，无则缺省） */
export function toLLMError(
  error: unknown,
  statusHint?: number,
): { error: LLMError; aborted: boolean } {
  // 显式 abort（signal 中止）优先（Error 实例或消息含 abort 关键词——pi-ai 的 aborted 消息恒为 "Request was aborted"）
  const alt = error as { errorMessage?: unknown; message?: unknown; status?: unknown };
  const rawMsg = typeof alt.errorMessage === "string" ? alt.errorMessage : typeof alt.message === "string" ? alt.message : String(error ?? "");
  if (error instanceof Error && (error.name === "AbortError" || error.message.includes("abort")) || rawMsg.includes("abort")) {
    return { error: { status: 0, code: LLM_TRANSPORT_ERROR_CODES.ABORTED, message: "Request was aborted" }, aborted: true };
  }
  const status = statusHint ?? extractStatusFromMessage(rawMsg);
  const code = extractCodeFromMessage(rawMsg);
  return { error: { status: status ?? 0, ...(code !== undefined ? { code } : {}), message: rawMsg }, aborted: false };
}

// ============ 模型目录查询（需求 3：模型选择/上下文占用显示的基础） ============

/** 模型信息（前端模型下拉与上下文占用分母） */
export interface ModelInfo {
  id: string;
  provider: string;
  displayName: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

/** 当前可用模型目录（供 GET /settings 扩展返回；测试可注入模型查找） */
export function getAvailableModels(providerId = "deepseek"): ModelInfo[] {
  const models = getModels();
  return models
    .getModels(providerId)
    .map((m) => ({
      id: m.id,
      provider: m.provider,
      displayName: m.name ?? m.id,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning === true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** 单模型查询；不存在返回 null */
export function resolveModelInfo(modelId: string, providerId = "deepseek"): ModelInfo | null {
  const m = modelLookup(providerId, modelId);
  if (m === undefined) return null;
  return {
    id: m.id,
    provider: m.provider,
    displayName: m.name ?? m.id,
    contextWindow: m.contextWindow,
    maxTokens: m.maxTokens,
    reasoning: m.reasoning === true,
  };
}

// ============ 核心流式调用（chatStream 内部实现：pi-ai 流事件转发） ============

export interface AdapterStreamParams {
  apiKey: string;
  model: string;
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  signal?: AbortSignalLike;
  maxTokens?: number;
  temperature?: number;
  /** 思考强度（决策 34：pi-ai reasoning 统一接口；'off' = 不传 reasoning 参数，其余映射 low/medium/high） */
  reasoning?: "off" | "low" | "medium" | "high";
  onEvent?: (event: LLMStreamEvent) => void;
  debugStream?: boolean;
}

/** 核心流式调用：调 pi-ai models.stream 并转发事件；返回 ChatStreamResult */
export async function streamChat(params: AdapterStreamParams): Promise<ChatStreamResult> {
  const { apiKey, model, messages, tools, signal, maxTokens, temperature, reasoning, onEvent, debugStream } = params;
  const models = getModels();

  // 模型解析：找不到指定模型时回退默认（配置漂移防御）
  const resolved = modelLookup("deepseek", model) ?? modelLookup("deepseek", FALLBACK_MODEL);
  if (resolved === undefined) {
    const error: LLMError = { status: 0, code: LLM_TRANSPORT_ERROR_CODES.ENV_UNSUPPORTED, message: `Model not available: ${model}` };
    onEvent?.({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  }

  const context = buildPiContext(messages, tools);
  let statusHint: number | undefined;
  let finalUsage: LLMUsage | null = null;
  let stopReason: string | null = null;
  const pendingToolCalls: LLMToolCallResult[] = []; // 缓存 tool_call 事件直到 done（决策 15 收尾统一判 length）

  try {
    const stream = models.stream(resolved, context, {
      apiKey,
      ...(signal !== undefined ? { signal: signal as AbortSignal } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      // 思考强度（决策 34）：off 不传（模型默认），low/medium/high 传 pi-ai reasoning 统一接口
      ...(reasoning !== undefined && reasoning !== "off" ? { reasoning } : {}),
      // 总是记录 HTTP status（错误分类需要；debugStream 时打印响应状态——[llm] stream 类别调试日志）
      onResponse: (res: { status: number }) => {
        statusHint = res.status;
        if (debugStream === true) {
          (globalThis as { console?: { debug?: (...a: unknown[]) => void } }).console?.debug?.(
            `[llm] stream status=${res.status} model=${resolved.id}`,
          );
        }
      },
    });
    for await (const event of stream) {
      switch (event.type) {
        case "text_delta": {
          onEvent?.({ type: "text", delta: event.delta });
          break;
        }
        case "toolcall_end": {
          const tc = event.toolCall;
          // 缓存到收尾统一发（决策 15：length 截断时全部标错——旧 finalizeToolCalls 同语义）
          pendingToolCalls.push({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            rawArguments: JSON.stringify(tc.arguments ?? {}),
          });
          break;
        }
        case "done": {
          finalUsage = convertUsage(event.message.usage);
          stopReason = normalizeStopReason(event.reason);
          // 决策 15：finish_reason=length（截断）时参数可能解析成功但静默不完整——
          // 所有缓存的工具调用标记错误后发出，让模型重发（旧 finalizeToolCalls 同语义）
          if (event.reason === "length") {
            for (const call of pendingToolCalls) {
              onEvent?.({
                type: "tool_call",
                toolCall: { ...call, error: "finish_reason=length：参数可能不完整，不执行（决策 15）" },
              });
            }
          } else {
            for (const call of pendingToolCalls) {
              onEvent?.({ type: "tool_call", toolCall: call });
            }
          }
          break;
        }
        case "error": {
          const { error, aborted } = toLLMError(event.error, statusHint);
          onEvent?.({ type: "error", error, aborted });
          return { ok: false, aborted, error };
        }
        // thinking_* 事件忽略不转发（YAGNI：本轮不展示思考过程；仅做参数控制）
      }
    }
  } catch (err) {
    // 流迭代异常：区分截断（STREAM_TRUNCATED）与网络错误（NETWORK_ERROR）——决策 15 两者均可重试
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const isTruncated = /stream ended|finish_reason|truncat/i.test(msg);
    const error: LLMError = {
      status: 0,
      code: isTruncated ? LLM_TRANSPORT_ERROR_CODES.STREAM_TRUNCATED : LLM_TRANSPORT_ERROR_CODES.NETWORK_ERROR,
      message: msg,
    };
    onEvent?.({ type: "error", error, aborted: false });
    return { ok: false, aborted: false, error };
  }

  // 流结束：发 finish（带 usage）+ done（正常结束）
  onEvent?.({ type: "finish", stopReason: stopReason ?? "stop", usage: finalUsage });
  onEvent?.({ type: "done" });
  return { ok: true, stopReason: stopReason ?? "stop", usage: finalUsage };
}

/** StopReason 归一化：pi-ai "toolUse" → "tool_calls"（agent/run.ts 依赖的停止原因口径） */
function normalizeStopReason(reason: string): string {
  switch (reason) {
    case "toolUse":
      return "tool_calls";
    case "stop":
      return "stop";
    case "length":
      return "length";
    default:
      return reason; // 透传（error/aborted 等异常路径已由 error 事件处理）
  }
}

/** 导出常量（与旧 client.ts 对齐入口；index.ts 应导出 adapter 全部） */
export { FALLBACK_MODEL };