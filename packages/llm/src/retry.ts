// @whispering233/ai-editor-llm 重试与错误分类（S6.2）
// 契约来源：doc/design/decisions.md 决策 15（重试分类与退避，2026-08 补充借鉴 pi）：
//   - 配额/计费类（402 / code 含 insufficient_quota / billing / quota）不可重试快失败
//   - 传输与瞬时类（429 / 5xx / 超时 / 网络断开 / 流截断）指数退避 baseDelay * 2^(n-1)
//     （参考默认 maxRetries=3、baseDelay=2000ms）
//   - abort 永不重试；退避 sleep 期间监听 abort 即时中断
//   - 重试计数「成功即清零」由调用方（S7.3 循环层）管理——本包只提供每次调用独立的
//     纯重试，不做全局状态
// 与 S6.1 chatStream 的错误模型对齐：{ status, code?, message }，传输层码
// ABORTED / NETWORK_ERROR / STREAM_TRUNCATED / CONSUMER_ERROR / NO_FETCH / ENV_UNSUPPORTED
import { ABORT_ERROR, LLM_TRANSPORT_ERROR_CODES } from "./client.js";
import type { AbortSignalLike, ChatStreamResult } from "./types.js";

/** 默认最大重试次数（不含首次尝试；决策 15 参考值） */
export const DEFAULT_MAX_RETRIES = 3;

/** 默认退避基数（ms）；退避 = baseDelay * 2^(attempt-1)（决策 15 参考值） */
export const DEFAULT_BASE_DELAY_MS = 2000;

/** 配额/计费类错误码关键词（决策 15：不可重试快失败；大小写不敏感子串匹配） */
const QUOTA_CODE_KEYWORDS = ["insufficient_quota", "billing", "quota"] as const;

/** 判断错误码是否属配额/计费类 */
function isQuotaCode(code: string | undefined): boolean {
  if (!code) return false;
  const lower = code.toLowerCase();
  return QUOTA_CODE_KEYWORDS.some((k) => lower.includes(k));
}

/**
 * 依据 S6.1 错误模型判定是否可重试（决策 15 分类）：
 * - 不可重试：abort（ABORTED）、消费者异常（CONSUMER_ERROR）、配额/计费类
 *   （402 或 code 命中关键词——code 优先于 status，如 500 + billing_error 也不重试）、
 *   401/403 及其他 4xx、环境缺失（NO_FETCH / ENV_UNSUPPORTED）、未知形态（保守不重试防死循环）
 * - 可重试：429、5xx、传输层 NETWORK_ERROR / STREAM_TRUNCATED（网络断开 / 截断 / 超时）
 */
export function classifyLLMError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false; // 未知形态：保守不可重试
  const e = err as { status?: unknown; code?: unknown };
  const status = typeof e.status === "number" ? e.status : 0;
  const code = typeof e.code === "string" ? e.code : undefined;

  // abort 永不重试（决策 15）
  if (code === LLM_TRANSPORT_ERROR_CODES.ABORTED) return false;
  // 消费者自身异常：非模型/网络问题，重试无意义
  if (code === LLM_TRANSPORT_ERROR_CODES.CONSUMER_ERROR) return false;
  // 配额/计费类：不可重试快失败（402 或 code 命中关键词）
  if (status === 402 || isQuotaCode(code)) return false;
  // 传输与瞬时类：可重试（429 / 5xx / 网络断开 / 流截断 / 超时）
  if (status === 429 || status >= 500) return true;
  if (code === LLM_TRANSPORT_ERROR_CODES.NETWORK_ERROR) return true;
  if (code === LLM_TRANSPORT_ERROR_CODES.STREAM_TRUNCATED) return true;
  // 其余（401/403/404/400、NO_FETCH / ENV_UNSUPPORTED 等）不可重试
  return false;
}

/** produce 的产出归一：value = resolve 成功值；error = reject 的异常（分类函数据此判定） */
export type RetryOutcome<T> =
  | { type: "value"; value: T }
  | { type: "error"; error: unknown };

/** withRetry 选项 */
export interface RetryOptions<T> {
  /**
   * 分类函数：产出（resolve 值或 reject 异常）→ 是否重试。
   * 成功值必须返回 false（直接返回）；chatStream 的失败是 resolve 出的
   * { ok:false, aborted, error } 值——由默认分类 classifyChatStreamOutcome 处理
   */
  isRetryable: (outcome: RetryOutcome<T>) => boolean;
  /** 最大重试次数（不含首次尝试；默认 3） */
  maxRetries?: number;
  /** 退避基数 ms（默认 2000）：baseDelay * 2^(attempt-1) */
  baseDelayMs?: number;
  /** 取消信号：abort 永不重试；退避 sleep 期间即时中断（reject ABORT_ERROR） */
  signal?: AbortSignalLike;
  /** 每次重试前回调（attempt 从 1 起；S7.3 可在此共享重试计数与日志） */
  onRetry?: (attempt: number, outcome: RetryOutcome<T>) => void;
}

/** 执行 produce 并归一为 outcome（resolve 值或捕获的异常） */
async function runProduce<T>(produce: () => Promise<T>): Promise<RetryOutcome<T>> {
  try {
    return { type: "value", value: await produce() };
  } catch (error) {
    return { type: "error", error };
  }
}

/**
 * 退避 sleep：监听 abort 即时中断（决策 15：退避期间 abort 即取消该次重试，不白等）
 * 定时器走运行时全局（llm 包 lib 仅 ES2022 无 DOM 类型，结构取用；Node 18+ / 浏览器必有）
 */
function sleepWithAbort(ms: number, signal?: AbortSignalLike): Promise<void> {
  const { setTimeout: schedule, clearTimeout: cancel } = globalThis as unknown as {
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  };
  return new Promise((resolve, reject) => {
    if (!schedule || !cancel) {
      reject(new Error("当前环境缺少 setTimeout/clearTimeout（需要 Node ≥ 18 或浏览器）"));
      return;
    }
    // 检查与监听注册之间无 await（同步原子段），此处检查已覆盖「刚被取消」的窗口
    if (signal?.aborted) {
      reject(ABORT_ERROR);
      return;
    }
    const onAbort = () => {
      cancel(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(ABORT_ERROR);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = schedule(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

/**
 * 通用重试（函数式；每次调用独立、无全局状态——「成功即清零」由 S7.3 循环层经 onRetry 管理）
 * 语义：
 *   - produce resolve → 直接返回（成功不重试）
 *   - produce reject / resolve 出失败值 → 交 isRetryable 分类：
 *     - 不可重试：resolve 值原样返回 / 异常原样抛回（快失败）
 *     - 可重试且未耗尽次数：指数退避 baseDelay * 2^(attempt-1) 后重试
 *     - 次数耗尽：最后一次产出原样返回 / 抛回（最终失败）
 *   - abort 永不重试：每次尝试前检查 + 退避 sleep 监听即时中断（抛 ABORT_ERROR，
 *     与 chatStream 的 "Request was aborted" 语义一致，决策 16）
 */
export async function withRetry<T>(
  produce: () => Promise<T>,
  options: RetryOptions<T>,
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const { isRetryable, signal, onRetry } = options;

  let retryCount = 0;
  while (true) {
    // abort 永不重试：每次尝试前检查（含首次——已取消则不发起请求）
    if (signal?.aborted) throw ABORT_ERROR;

    const outcome = await runProduce(produce);

    // 不可重试（含成功值）或重试次数耗尽：原样返回 / 抛回原始异常（最终失败）
    if (!isRetryable(outcome) || retryCount >= maxRetries) {
      if (outcome.type === "value") return outcome.value;
      throw outcome.error;
    }

    // 可重试：先确认未被取消，再退避等待（sleep 期间 abort 即时中断）
    if (signal?.aborted) throw ABORT_ERROR;
    onRetry?.(retryCount + 1, outcome);
    retryCount += 1;
    await sleepWithAbort(baseDelayMs * 2 ** (retryCount - 1), signal);
  }
}

/**
 * chatStream 集成默认分类（供 S7.3 直接使用）：
 * chatStream 从不 throw（S6.1 契约）——失败是 resolve 出的 { ok:false, aborted, error } 值；
 * 异常路径仅防御性覆盖（未知形态 → 不可重试）
 */
export function classifyChatStreamOutcome(outcome: RetryOutcome<ChatStreamResult>): boolean {
  if (outcome.type === "error") return classifyLLMError(outcome.error);
  return outcome.value.ok ? false : classifyLLMError(outcome.value.error);
}
