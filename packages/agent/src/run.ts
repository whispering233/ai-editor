// @ai-editor/agent 主循环（S7.3）
//
// 契约来源：
//   - doc/design/tasks.md S7.3（三重保险：8 轮 / 120s 单轮 / token 预算；length 截断不执行
//     任何 tool_call 全部标错重发；重试与轮次分开计量（报告值累计不清零，ora S7.3 审核
//     S6 口径——决策 15「成功即清零」为预算语义，由 withRetry maxRetries + deadline 兜底）；
//     120s 含重试退避与工具执行（调度前/后均校验，ora S7.3 审核 M2）；
//     超时信号与用户取消分离；abort 双形态归一）
//   - doc/design/decisions.md 决策 15（循环终止与失败处理全量）、决策 16（取消信号四层穿透——
//     本层是第 0 层循环层，fetch / 读循环 / 工具执行 / 重试 sleep 已由 llm/tools 承担）、
//     决策 18（半条 assistant 不喂回——失败轮重试复用原 payload）
//   - doc/api/endpoints.md POST /api/v1/chat 事件契约（六类事件：tool_call / tool_result /
//     proposal / text / done / error；proposal 在对应 tool_result 之后、循环继续之前发送；
//     error 后流立即关闭；done 携带 session_id）——AgentEvent 与其对齐，S7.6 路由层转 SSE 帧
//   - S7.2 context.ts（buildContext + meta.effectiveLastUsage 回写契约：历史段真实用量 =
//     usage.prompt_tokens - (system + toolList + focus 估算)，下轮按换算公式重新计算传入）
//   - packages/llm/src/{client,retry}.ts（chatStream 结果形态 / withRetry / classifyLLMError /
//     ABORT_ERROR——abort 双形态归一 helper 见本文件）
//
// 架构边界：本包**不依赖 db**——消息持久化由 S7.6 server 层负责（onMessages 回调输出每轮
// 新消息序列，本文件只定义接口不落库）；工具执行 / 批量校验 / 提案仓在 S7.4（本文件只定义
// ToolDispatcher 接口与消费契约，测试用 mock，S7.4 提供真实现）。

import { ERROR_CODES } from "@ai-editor/shared/schemas";
import type { ErrorCode } from "@ai-editor/shared";
import {
  ABORT_ERROR,
  classifyLLMError,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  LLM_TRANSPORT_ERROR_CODES,
  withRetry,
  type AbortSignalLike,
  type ChatStreamResult,
  type LLMError,
  type LLMMessage,
  type LLMStreamEvent,
  type LLMToolCallRequest,
  type LLMToolCallResult,
  type LLMUsage,
  type RetryOutcome,
} from "@ai-editor/llm";
import {
  buildContext,
  type AssembledContext,
  type ContextBudgets,
  type ToolListEntry,
} from "./context.js";
import { appendMessage, retryPayload, type SessionMessage, type SessionState } from "./session.js";

// ============ 三重保险默认值（决策 15） ============

/** 轮次上限（决策 15：8 轮；持续 tool_call 死循环兜底） */
export const DEFAULT_MAX_ROUNDS = 8;

/** 单轮总预算 ms（决策 15：120s，含 LLM 重试退避与工具执行；测试可覆盖） */
export const DEFAULT_ROUND_TIMEOUT_MS = 120_000;

/**
 * 单次 attempt 超时 ms（决策 15：「LLM 单次 attempt 另有自身 fetch 超时」落地——
 * 独立于 120s 单轮总预算；attempt 超时映射为可重试错误，轮内重试仍受 roundDeadline 兜底）。
 */
export const DEFAULT_ATTEMPT_TIMEOUT_MS = 60_000;

/** 上下文 token 预算（决策 15：60K——DeepSeek 64K 窗口留余量；测试可覆盖） */
export const DEFAULT_TOKEN_BUDGET = 60_000;

// ============ 事件类型（endpoints.md 六类事件 + 循环内部事件，S7.6 转 SSE 帧） ============

/** 提案载荷（S7.4 工具调度层构造 preview；对齐 endpoints.md proposal 事件 data 形态） */
export interface ProposalPayload {
  proposal_id: string;
  /** 提案类型 = 产生它的 propose_* 工具名（endpoints.md data.type） */
  type: string;
  /** 提案预览（前端提案卡渲染数据；本层透传不构造） */
  preview: Record<string, unknown>;
}

/**
 * runAgent 输出事件流：
 * - turn_start：循环内部事件（每轮开始；S7.6 可不映射 SSE 帧，用于日志/调试）
 * - text：AI 文本增量（实时转发，失败轮可能已流出的半条文本属重试语义，接受）
 * - tool_call / tool_result：工具调用与结果（按 tool_call_id 配对；length 截断的调用
 *   不发 dispatcher，仍发 tool_call 事件）
 * - proposal：恒在对应 tool_result 之后、循环继续之前发送（endpoints.md 顺序约定）
 * - done：自然终止（无工具调用），携带 session_id
 * - error：终止（决策 15：模型最终失败 / 8 轮上限 / 超时 / token 超限 / 调度器缺陷）或
 *   用户取消（aborted=true，决策 16）；S7.6 收到 error 后立即关闭流
 */
export type AgentEvent =
  | { type: "turn_start"; round: number }
  | { type: "text"; delta: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> | null; id: string }
  | { type: "tool_result"; tool: string; result: string; id: string }
  | { type: "proposal"; proposal: ProposalPayload }
  | { type: "done"; sessionId: string }
  | { type: "error"; code: string; message: string; aborted: boolean };

// ============ 工具调度接口（S7.4 真实现；本文件只定义与消费） ============

/** 待调度工具调用（LLMToolCallResult 解析成功后的形态：id/tool/parsed args——S7.4 executor 直接 zod 校验执行） */
export interface DispatchToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

/** 单个工具调度结果（S7.4 构造；isError=true 结构化回填、不终止循环） */
export interface DispatchResult {
  id: string;
  tool: string;
  /**
   * 执行成功与否（与 isError 同义冗余——按任务卡接口保留双字段；ora S7.3 审核 S4：
   * 本卡不消费 ok，留 S7.4 真实现构造时使用，接口不动）
   */
  ok: boolean;
  /** 失败标记：喂回 LLM 的内容须含错误说明（决策 15 结构化喂回自纠） */
  isError: boolean;
  /** 回填 LLM 的 tool 消息内容（成功 = 结果 JSON/文本；失败 = 错误说明） */
  content: string;
  /** 提案数据（仅 propose_* 工具返回；触发 proposal 事件） */
  proposal?: ProposalPayload;
}

/**
 * 工具调度器：
 * - 输入按原 tool_call 顺序；输出**必须同序等长**（防御：条数不符 → AGENT_DISPATCH_ERROR 终止，
 *   防止 tool_call ↔ tool_result 错位配对——决策 18）
 * - signal：决策 16 ③「工具执行中检查取消」（S7.4 executor 承担；长工具执行须监听）
 * - 本层不抛错（失败编码进 isError 结果）；抛错视为调度器缺陷 → 循环终止
 */
export type ToolDispatcher = (
  calls: DispatchToolCall[],
  signal?: AbortSignalLike,
) => Promise<DispatchResult[]>;

// ============ 输入 / 输出 ============

/** runAgent 依赖注入（S7.6 组装） */
export interface RunAgentDeps {
  /**
   * 模型调用（S7.6 注入：闭包持有 apiKey/model/tools，内部调用 llm chatStream）。
   * **契约**：必须把 onEvent 转发给 chatStream 的 onEvent——runAgent 依赖它累积文本与
   * 收集工具调用（失败轮的重试会自动丢弃旧累积，无需调用方处理）；失败按 chatStream
   * 契约 resolve 出 { ok:false, ... }，不 throw。
   * signal 由 runAgent 注入 attempt 级独立控制器（超时 abort 与用户取消分离，决策 15）。
   */
  produce: (
    messages: LLMMessage[],
    signal: AbortSignalLike,
    onEvent?: (event: LLMStreamEvent) => void,
  ) => Promise<ChatStreamResult>;
  /** 工具调度（S7.4 真实现） */
  dispatcher: ToolDispatcher;
  /**
   * 事件输出（S7.6 转 SSE 帧；缺省丢弃）。
   * **硬契约（ora S7.3 审核 S3）**：回调抛错不逃逸——run 侧统一兜底吞掉（防 runAgent
   * 直接 reject 导致 SSE 异常关流而非 error 事件）；S7.6 不得依赖异常传播通知故障。
   */
  onEvent?: (event: AgentEvent) => void;
  /**
   * 每轮新消息序列（S7.6 持久化到 chat_messages；本层不落库）。
   * **硬契约同上**：抛错不逃逸（落库失败由 S7.6 自行处理，不中断 agent 循环）。
   */
  onMessages?: (messages: SessionMessage[]) => void;
}

export interface RunAgentInput {
  /** 会话 ID（done 事件携带；S7.6 必传——创建/复用会话后传入） */
  sessionId?: string;
  /** 本轮用户消息（由本层追加进会话——S7.6 传入的 session 不应已含它，避免双写） */
  userMessage: string;
  /** 初始会话（S7.6 经 loadHistory/trimSession 加载的历史；不含本轮 userMessage） */
  session: SessionState;
  /** 聚焦上下文文本（决策 6 聚焦层；S7.6 查询实体/大纲节点后拼好传入） */
  focus?: string;
  /** 项目提示词（决策 7 项目层） */
  projectPrompt?: string;
  /** 临时指令（决策 7 临时层） */
  instruction?: string;
  deps: RunAgentDeps;
  /** 用户取消信号（决策 16：全链路第 0 层；abort 永不重试） */
  signal?: AbortSignalLike;
  /** 分层上下文预算覆盖（S7.2） */
  budgets?: Partial<ContextBudgets>;
  /** 工具清单（默认 registry listTools；S7.2 注入 system 消息） */
  tools?: ToolListEntry[];
  /** 轮次上限（决策 15：默认 8；测试可覆盖） */
  maxRounds?: number;
  /** 单轮总预算 ms（决策 15：默认 120s 含重试退避；测试可覆盖） */
  roundTimeoutMs?: number;
  /** 单次 attempt 超时 ms（决策 15：默认 60s——LLM 单次调用独立超时，与轮次总预算分离；测试可覆盖） */
  attemptTimeoutMs?: number;
  /** 上下文 token 预算（决策 15：默认 60K；测试可覆盖） */
  tokenBudget?: number;
  /** 每次模型调用最大重试次数（决策 15：默认 3；测试可覆盖） */
  maxRetries?: number;
  /** 重试退避基数 ms（决策 15：默认 2000；测试可覆盖） */
  retryBaseDelayMs?: number;
}

export interface RunAgentResult {
  ok: boolean;
  /** 用户取消（决策 16：abort 不重试，立即终止） */
  aborted: boolean;
  /** 终止原因（ok=false 时；code 为 AGENT_MAX_ITERATIONS / AGENT_TIMEOUT / AGENT_TOKEN_BUDGET
   * 或模型错误码 / 调度器缺陷码） */
  error: LLMError | null;
  /** 实际执行轮数（≤ maxRounds） */
  rounds: number;
  /**
   * 重试累计（决策 15：重试与轮次分开计量、不互相消耗；ora S7.3 审核 S6 断言口径——
   * 报告值不清零，为全程累计：最后一次成功轮前重试过几次即为其值；「成功即清零」的预算
   * 语义由 withRetry maxRetries 独立限制 + roundDeadline 兜底承担，无跨轮累计消耗问题）
   */
  retries: number;
}

// ============ 内部辅助 ============

/** attempt 超时合成错误（决策 15：超时映射为**可重试**类，与用户取消分离——勿把 AbortSignal.timeout 直挂用户取消链路） */
const ATTEMPT_TIMEOUT_CODE = "ATTEMPT_TIMEOUT";
const ATTEMPT_TIMEOUT_ERROR: LLMError = {
  status: 0,
  code: ATTEMPT_TIMEOUT_CODE,
  message: "单次模型调用超时（轮次预算内可重试，决策 15）",
};
const ATTEMPT_TIMEOUT_RESULT: ChatStreamResult = {
  ok: false,
  aborted: false,
  error: ATTEMPT_TIMEOUT_ERROR,
};

/** length 截断兜底说明（LLMToolCallResult.error 缺失时——finalizeToolCalls 正常必已标记） */
const LENGTH_TRUNCATION_NOTICE = "finish_reason=length：参数可能不完整，不执行（决策 15）";

/**
 * 终止类错误码取值（ErrorCode 单一来源；shared barrel 仅类型导出，运行时常量走 schemas 子路径——
 * 与 tools 包同款导入策略）。
 */
function codeOf(name: string): ErrorCode {
  const found = ERROR_CODES.find((c) => c === name);
  if (!found) throw new Error(`run.ts: ErrorCode ${name} 不在枚举中`);
  return found;
}
const CODE_MAX_ITERATIONS = codeOf("AGENT_MAX_ITERATIONS");
const CODE_TIMEOUT = codeOf("AGENT_TIMEOUT");
const CODE_TOKEN_BUDGET = codeOf("AGENT_TOKEN_BUDGET");
const CODE_DISPATCH = codeOf("AGENT_DISPATCH_ERROR");
const CODE_INTERNAL = codeOf("AGENT_INTERNAL_ERROR");

/** 环境结构取用：agent 包 lib 仅 ES2022、无 DOM 类型——与 llm 包同款策略（Node ≥ 18 / 浏览器运行时必有） */
interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(): void;
}

/** 创建 AbortController（结构取用，避免依赖 DOM lib） */
function createAbortController(): AbortControllerLike {
  const Ctor = (globalThis as unknown as { AbortController?: new () => AbortControllerLike }).AbortController;
  if (!Ctor) throw new Error("当前环境缺少 AbortController（需要 Node ≥ 18 或浏览器）");
  return new Ctor();
}

/** 一次性定时器（结构取用 setTimeout/clearTimeout；返回 clear 句柄） */
function createTimer(callback: () => void, ms: number): { clear(): void } {
  const { setTimeout: schedule, clearTimeout: cancel } = globalThis as unknown as {
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  if (!schedule || !cancel) throw new Error("当前环境缺少 setTimeout/clearTimeout（需要 Node ≥ 18 或浏览器）");
  const handle = schedule(callback, ms);
  return { clear: () => cancel(handle) };
}

/** ABORT_ERROR 判等（按码匹配——容忍拷贝形态） */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === LLM_TRANSPORT_ERROR_CODES.ABORTED
  );
}

/** attempt 超时错误判等 */
function isAttemptTimeoutError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === ATTEMPT_TIMEOUT_CODE
  );
}

/**
 * 主循环重试分类：可重试 = llm 传输类（429/5xx/网络断开/流截断，决策 15）∪ attempt 超时；
 * abort（ABORTED 码）由 classifyLLMError 判为不可重试（决策 16：取消不重试）。
 */
function classifyRunOutcome(outcome: RetryOutcome<ChatStreamResult>): boolean {
  if (outcome.type === "error") return isAttemptTimeoutError(outcome.error) || classifyLLMError(outcome.error);
  if (outcome.value.ok) return false;
  return isAttemptTimeoutError(outcome.value.error) || classifyLLMError(outcome.value.error);
}

/**
 * abort 双形态归一（ora S6.2 审核 2026-08）：
 * chatStream 流中返回 { ok:false, aborted }（resolve 形态）vs withRetry 尝试前/退避 sleep
 * 抛 ABORT_ERROR（throw 形态）——此处统一为 resolve 形态 { ok:false, aborted, error }，
 * 主循环只处理一种形态。同时实现「超时信号与用户取消分离」（决策 15/16）：
 * attempt 超时（timedOut=true 且非用户取消）→ 归一为**可重试** ATTEMPT_TIMEOUT；
 * 用户取消 → aborted 原样（不重试）。
 * 非 abort 异常照原样抛出（防御路径——chatStream 契约本不 throw，交 withRetry 分类）。
 */
function normalizeAttemptError(err: unknown, timedOut: boolean, userAborted: boolean): ChatStreamResult {
  if (isAbortError(err)) {
    if (!userAborted && timedOut) return ATTEMPT_TIMEOUT_RESULT;
    return { ok: false, aborted: true, error: ABORT_ERROR };
  }
  throw err;
}

/** 同上（resolve 形态入口：produce 正常返回但被 attempt 超时中止时 timedOut=true） */
function normalizeAttemptResult(result: ChatStreamResult, timedOut: boolean, userAborted: boolean): ChatStreamResult {
  // S2（ora 审核）：超时定时器触发与 produce 成功 resolve 的竞态防御——定时器先置 timedOut、
  // abort 尚未生效时 produce 恰返回 ok，该轮不得按成功轮处理（否则超时轮被当成功轮进入调度）
  if (result.ok && timedOut && !userAborted) return ATTEMPT_TIMEOUT_RESULT;
  if (result.ok) return result;
  if (result.aborted && !userAborted) {
    return timedOut ? ATTEMPT_TIMEOUT_RESULT : result; // 超时 → 可重试；未知来源 abort 原样（防御不可重试）
  }
  return result;
}

/**
 * S7.2 回写契约：历史段真实用量换算（口径统一，ora S7.3 审核 S1——三处注释等价表述，
 * 见 context.ts BuildContextInput.lastUsage 与 llm/token.ts EstimateMessagesTokensOptions.lastUsage）：
 * - 以 usage.prompt_tokens 为起点：减 system + toolList + focus 估算（completion 属输出、
 *   不占 prompt_tokens，无需扣除）
 * - 以 usage.total_tokens 为起点：再减 completion_tokens（total = prompt + completion，
 *   两式等价：total - (system+toolList+focus+completion) = prompt - (system+toolList+focus)）
 * 下一轮 buildContext 以该值作 lastUsage（estimateMessagesTokens 基线）；上下文触发裁剪后
 * buildContext 会重置基线（meta.effectiveLastUsage=null），下轮从此处按最新 usage 重新换算——
 * 决策 6 防预算漂移。
 */
function toHistoryBaseline(usage: LLMUsage | null, tokens: AssembledContext["tokens"]): LLMUsage | null {
  if (usage === null) return null;
  const historyTokens = Math.max(0, usage.prompt_tokens - tokens.system - tokens.toolList - tokens.focus);
  return { prompt_tokens: historyTokens, completion_tokens: 0, total_tokens: historyTokens };
}

/** LLMToolCallResult（解析后形态）→ wire 请求形态（assistant.tool_calls 回填原始 arguments 串——决策 18 配对依赖 id） */
function toWireToolCalls(calls: readonly LLMToolCallResult[]): LLMToolCallRequest[] {
  return calls.map((c) => ({
    id: c.id,
    type: "function" as const,
    function: { name: c.name, arguments: c.rawArguments },
  }));
}

// ============ 主循环 ============

/**
 * runAgent：对话主循环（S7.3）。每轮：buildContext（含 lastUsage 回写链）→ LLM 调用
 * （withRetry + classifyRunOutcome + attempt 独立超时）→ 文本实时转发 → 成功收尾：
 *   - 无 tool_call → done 事件终止
 *   - stopReason=length → 全部 tool_call 标错喂回（不执行，决策 15）
 *   - 有合法 tool_call → dispatcher 执行 → tool_result 事件（按 id 回填）→ proposal 事件
 *     （在 tool_result 后、循环继续前）→ 结果回填会话 → 下一轮
 * 三重保险（决策 15）：8 轮上限 / 120s 单轮总预算（含重试退避**与工具执行**——调度前与
 * dispatcher 返回后均校验 deadline）/ token 预算，各自发 error 事件终止。工具失败（isError）
 * 结构化回填不终止（喂回自纠）；模型失败按重试策略退避重试，重试与轮次分开计量（报告值
 * 累计不清零，见 result.retries 注释）；abort 双形态归一后循环只处理 resolve 形态。
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const {
    sessionId,
    userMessage,
    focus,
    projectPrompt,
    instruction,
    deps,
    signal,
    budgets,
    tools,
    maxRounds = DEFAULT_MAX_ROUNDS,
    roundTimeoutMs = DEFAULT_ROUND_TIMEOUT_MS,
    attemptTimeoutMs = DEFAULT_ATTEMPT_TIMEOUT_MS,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseDelayMs = DEFAULT_BASE_DELAY_MS,
  } = input;
  // 安全 emit / onMessages（ora S7.3 审核 S3）：消费者回调抛错不逃逸——runAgent 不得因
  // S7.6 的 SSE 写入或落库异常直接 reject（那会导致 SSE 异常关流而非 error 事件）
  const emit = (event: AgentEvent) => {
    try {
      deps.onEvent?.(event);
    } catch {
      // 消费者抛错被吞：事件流继续（S7.6 不得依赖异常传播）
    }
  };
  const emitMessages = (messages: SessionMessage[]) => {
    try {
      deps.onMessages?.(messages);
    } catch {
      // 落库抛错被吞：循环继续（S7.6 应自行处理持久化失败）
    }
  };

  // 用户消息入会话（S7.6 传入的 session 不应已含本轮消息——由本层追加，避免双写）
  let session = appendMessage(input.session, { role: "user", content: userMessage });
  let rounds = 0;
  let retries = 0; // 重试累计（决策 15：重试与轮次分开计量、不互相消耗；报告值不清零——见下方说明）
  let lastUsage: LLMUsage | null = null; // 历史段基线（S7.2 回写契约换算）

  while (rounds < maxRounds) {
    rounds += 1;
    emit({ type: "turn_start", round: rounds });

    // ---- 1. 组装上下文（S7.2：三层注入 + 聚焦 + 工具清单 + 成对裁剪 + usage 基线） ----
    const ctx = buildContext({
      history: session,
      focus,
      projectPrompt,
      instruction,
      lastUsage,
      budgets,
      tools,
    });

    // ---- 2. 取消检查（决策 16 优先于预算：已取消且并发超限时先 aborted 终止，不发 token error） ----
    if (signal?.aborted) {
      emit({ type: "error", code: ABORT_ERROR.code ?? "ABORTED", message: ABORT_ERROR.message, aborted: true });
      return { ok: false, aborted: true, error: ABORT_ERROR, rounds, retries };
    }

    // ---- 3. token 预算（三重保险之三；决策 15：超限发 error 终止） ----
    if (ctx.tokens.total > tokenBudget) {
      const message = `上下文 token 估算 ${ctx.tokens.total} 超出预算 ${tokenBudget}（决策 15）`;
      emit({ type: "error", code: CODE_TOKEN_BUDGET, message, aborted: false });
      return { ok: false, aborted: false, error: { status: 0, code: CODE_TOKEN_BUDGET, message }, rounds, retries };
    }

    // ---- 4. 单轮 deadline（三重保险之二：120s 含重试退避与工具执行，决策 15） ----
    const roundDeadline = Date.now() + roundTimeoutMs;

    // ---- 5. 模型调用：withRetry + attempt 独立超时控制器 + abort 双形态归一 ----
    // 本轮文本/工具调用累积（attempt 级变量——重试自动丢弃失败轮累积，半条 assistant 不重发）
    let attemptText = "";
    let attemptCalls: LLMToolCallResult[] = [];
    const attempt = async (): Promise<ChatStreamResult> => {
      const remaining = roundDeadline - Date.now();
      if (remaining <= 0) return ATTEMPT_TIMEOUT_RESULT; // 轮次预算耗尽（含退避）：不再发起请求
      attemptText = "";
      attemptCalls = [];
      // 独立 AbortController：超时 abort 与用户取消分离（决策 15）——勿把 AbortSignal.timeout
      // 直挂用户取消链路（会把超时误判为取消、吞掉可重试机会）。
      // attempt 超时 = min(剩余轮次预算, attemptTimeoutMs)：单次调用有自身超时（决策 15
      // 「LLM 单次 attempt 另有自身 fetch 超时」），轮内重试仍受 roundDeadline 兜底
      const controller = createAbortController();
      let timedOut = false;
      const timer = createTimer(() => {
        timedOut = true;
        controller.abort();
      }, Math.min(remaining, attemptTimeoutMs));
      const onUserAbort = () => controller.abort();
      signal?.addEventListener("abort", onUserAbort, { once: true });
      try {
        // 决策 18：失败轮重试复用原 payload（半条 assistant 绝不追加）
        const payload = retryPayload(ctx.messages);
        const result = await deps.produce(payload, controller.signal, (event) => {
          if (event.type === "text") {
            attemptText += event.delta;
            emit({ type: "text", delta: event.delta }); // 文本实时转发（失败轮已流出的半条文本属重试语义，接受）
          } else if (event.type === "tool_call") {
            attemptCalls.push(event.toolCall); // 缓冲：produce 成功后才发 tool_call 事件
          }
        });
        return normalizeAttemptResult(result, timedOut, signal?.aborted === true);
      } catch (err) {
        return normalizeAttemptError(err, timedOut, signal?.aborted === true);
      } finally {
        timer.clear();
        signal?.removeEventListener("abort", onUserAbort);
      }
    };
    // 可重试分类 + 轮次预算兜底（预算耗尽即不再重试，最终以超时错误终止）
    const isRetryable = (outcome: RetryOutcome<ChatStreamResult>): boolean => {
      if (roundDeadline - Date.now() <= 0) return false;
      return classifyRunOutcome(outcome);
    };

    let result: ChatStreamResult;
    try {
      result = await withRetry(attempt, {
        isRetryable,
        signal, // 决策 16：用户取消不重试；退避 sleep 即时中断（llm/retry.ts 承担）
        maxRetries,
        baseDelayMs: retryBaseDelayMs,
        onRetry: () => {
          retries += 1; // 重试与轮次分开计量（决策 15）
        },
      });
    } catch (err) {
      // withRetry 抛出的 ABORT_ERROR（尝试前检查 / 退避 sleep 中断）：用户取消，归一为 aborted 结果
      if (isAbortError(err)) {
        emit({ type: "error", code: ABORT_ERROR.code ?? "ABORTED", message: ABORT_ERROR.message, aborted: true });
        return { ok: false, aborted: true, error: ABORT_ERROR, rounds, retries };
      }
      // 防御路径：未知异常（chatStream 契约不 throw，理论不可达）
      const error: LLMError = { status: 0, code: CODE_INTERNAL, message: err instanceof Error ? err.message : String(err) };
      emit({ type: "error", code: CODE_INTERNAL, message: error.message, aborted: false });
      return { ok: false, aborted: false, error, rounds, retries };
    }

    // ---- 5. 模型调用最终失败 → error 事件终止（决策 15：最终失败以 error 呈现，不静默） ----
    if (!result.ok) {
      // attempt 超时耗尽重试后终止：错误码映射为 ErrorCode 的 AGENT_TIMEOUT（SSE 事件契约）
      const code = isAttemptTimeoutError(result.error) ? CODE_TIMEOUT : (result.error.code ?? "MODEL_ERROR");
      const error: LLMError = { ...result.error, code };
      emit({ type: "error", code, message: error.message, aborted: result.aborted });
      return { ok: false, aborted: result.aborted, error, rounds, retries };
    }

    // ---- 6. 成功：历史段基线换算（S7.2 回写契约）。
    // 注：retries 报告值**不清零**（ora S7.3 审核 S6 断言口径）——决策 15「成功即清零」
    // 针对的是预算计数语义（防跨轮累计吃满 8 轮预算），本实现每轮重试由 withRetry 的
    // maxRetries 独立限制、轮次预算由 roundDeadline 兜底，不存在跨轮累计消耗预算的问题，
    // 报告值取全程累计便于诊断（retries=1 即「本轮成功前重试过 1 次」） ----
    lastUsage = toHistoryBaseline(result.usage, ctx.tokens);

    const calls = attemptCalls;
    const assistantContent = attemptText === "" ? null : attemptText;
    const assistantMsg: SessionMessage =
      calls.length > 0
        ? { role: "assistant", content: assistantContent, tool_calls: toWireToolCalls(calls) }
        : { role: "assistant", content: assistantContent };

    // ---- 7. 无工具调用 → done 终止（endpoints.md：done 携带 session_id） ----
    if (calls.length === 0) {
      session = appendMessage(session, assistantMsg);
      emitMessages([assistantMsg]);
      emit({ type: "done", sessionId: sessionId ?? "" });
      return { ok: true, aborted: false, error: null, rounds, retries };
    }

    // ---- 8. 工具调用事件（produce 成功后才发出——失败轮的缓冲调用丢弃，不产生脏事件） ----
    for (const c of calls) {
      emit({ type: "tool_call", tool: c.name, args: c.arguments ?? null, id: c.id });
    }

    // ---- 9. 调度前检查轮次预算（ora S7.3 审核 M2：决策 15「单轮总预算含工具执行」——
    // attempt 成功后若预算已耗尽，直接 AGENT_TIMEOUT 终止、不再调度工具） ----
    if (roundDeadline - Date.now() <= 0) {
      const message = `单轮预算耗尽（${roundTimeoutMs}ms 含工具执行，决策 15）`;
      emit({ type: "error", code: CODE_TIMEOUT, message, aborted: false });
      return { ok: false, aborted: false, error: { status: 0, code: CODE_TIMEOUT, message }, rounds, retries };
    }

    // ---- 10. 调度：length 截断（决策 15）与参数解析失败/缺 id 的调用一律不执行、标错喂回 ----
    const truncated = result.stopReason === "length";
    const results: DispatchResult[] = new Array(calls.length);
    const toDispatch: DispatchToolCall[] = [];
    const pending: number[] = [];
    for (const [i, c] of calls.entries()) {
      if (truncated || c.error !== undefined) {
        // 截断/解析失败的调用：合成失败结果（LLMToolCallResult.error 已含说明，含 length 口径）
        results[i] = {
          id: c.id,
          tool: c.name,
          ok: false,
          isError: true,
          content: c.error ?? LENGTH_TRUNCATION_NOTICE,
        };
      } else {
        toDispatch.push({ id: c.id, tool: c.name, args: c.arguments ?? {} });
        pending.push(i);
      }
    }

    if (toDispatch.length > 0) {
      let dispatched: DispatchResult[];
      try {
        dispatched = await deps.dispatcher(toDispatch, signal); // 决策 16 ③：工具执行中检查取消（S7.4 承担）
      } catch (err) {
        // 调度器抛错视为缺陷：终止（不喂回——避免把内部错误当工具结果循环重试）
        const message = `工具调度器抛错：${err instanceof Error ? err.message : String(err)}`;
        emit({ type: "error", code: CODE_DISPATCH, message, aborted: false });
        return {
          ok: false,
          aborted: false,
          error: { status: 0, code: CODE_DISPATCH, message },
          rounds,
          retries,
        };
      }
      // 契约：同序等长（防御——错位回填破坏 tool_call ↔ tool_result 配对，决策 18）
      if (dispatched.length !== toDispatch.length) {
        const message = `工具调度结果条数不符：期望 ${toDispatch.length}，实际 ${dispatched.length}`;
        emit({ type: "error", code: CODE_DISPATCH, message, aborted: false });
        return {
          ok: false,
          aborted: false,
          error: { status: 0, code: CODE_DISPATCH, message },
          rounds,
          retries,
        };
      }
      // 契约：id 交叉校验（ora S7.3 审核 S5——条数虽等但结果 id 与输入错位同样破坏配对）
      for (let k = 0; k < dispatched.length; k++) {
        if (dispatched[k].id !== toDispatch[k].id) {
          const message = `工具调度结果 id 错位：期望 ${toDispatch[k].id}，实际 ${dispatched[k].id}`;
          emit({ type: "error", code: CODE_DISPATCH, message, aborted: false });
          return {
            ok: false,
            aborted: false,
            error: { status: 0, code: CODE_DISPATCH, message },
            rounds,
            retries,
          };
        }
      }
      dispatched.forEach((r, k) => {
        results[pending[k]] = r;
      });
    }

    // 调度后检查轮次预算（ora S7.3 审核 M2：工具执行可能耗时——执行中的工具无法中止
    // （仅用户取消可中断），超出的后果 = 终止，即满足「120s 含工具执行」的预算语义）
    if (roundDeadline - Date.now() <= 0) {
      const message = `单轮预算耗尽（${roundTimeoutMs}ms 含工具执行，决策 15）`;
      emit({ type: "error", code: CODE_TIMEOUT, message, aborted: false });
      return { ok: false, aborted: false, error: { status: 0, code: CODE_TIMEOUT, message }, rounds, retries };
    }

    // 调度后检查取消（决策 16：工具执行期间可能被取消——S7.4 执行中检查外的最后兜底）
    if (signal?.aborted) {
      emit({ type: "error", code: ABORT_ERROR.code ?? "ABORTED", message: ABORT_ERROR.message, aborted: true });
      return { ok: false, aborted: true, error: ABORT_ERROR, rounds, retries };
    }

    // ---- 11. 结构化回填会话 + 事件（tool_result → proposal，proposal 在循环继续前） ----
    const toolMsgs: SessionMessage[] = [];
    for (const r of results) {
      toolMsgs.push({ role: "tool", content: r.content, tool_call_id: r.id });
      emit({ type: "tool_result", tool: r.tool, result: r.content, id: r.id });
      if (r.proposal !== undefined) {
        emit({ type: "proposal", proposal: r.proposal }); // endpoints.md：proposal 在 tool_result 后、循环继续前
      }
    }
    session = appendMessage(session, assistantMsg);
    for (const t of toolMsgs) session = appendMessage(session, t);
    emitMessages([assistantMsg, ...toolMsgs]);

    // 循环继续：下一轮模型看到工具结果后自纠或收尾
  }

  // ---- 11. 8 轮上限（三重保险之一；决策 15：持续 tool_call 死循环兜底） ----
  const message = `达到最大轮数上限 ${maxRounds}（决策 15）`;
  emit({ type: "error", code: CODE_MAX_ITERATIONS, message, aborted: false });
  return { ok: false, aborted: false, error: { status: 0, code: CODE_MAX_ITERATIONS, message }, rounds, retries };
}
