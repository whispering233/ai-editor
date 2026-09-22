// pi 运行时：会话累计用量（状态栏账目口径）
//
// 契约 = docs/api/80-api-chat.md「会话用量字段」+ docs/design/20-context.md §2.1：
// 本模块是 `usage` 的唯一实现点，口径逐条对齐 pi `AgentSession.getSessionStats()`——
// 只有三类计入：assistant 消息、`toolResult.usage`（工具自身开销）、
// `compaction` / `branch_summary` 的 usage（压缩与分支摘要同样要付费，账目不能漏）。
// 命中率与订阅布尔同在此处算：客户端只格式化，不复算分母。

import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ChatUsage } from "@whispering233/ai-editor-shared";

/**
 * 订阅制 provider（走 API-key 认证但按订阅计费，pi footer 同款判定）。
 * 该字面量只在此处出现一次——别处要判订阅一律复用 `sessionUsage()` 的结论。
 */
const SUBSCRIPTION_PROVIDER = "kimi-coding";

/** 累加器（不就地改写入参） */
interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SessionUsageOptions {
  /** 该 provider 是否用 OAuth 凭据（= pi `ModelRuntime.isUsingOAuth()`） */
  isUsingOAuth: (provider: string) => boolean;
}

/** 单条 entry 计入账目的 usage（user / 状态类 entry 不产生费用） */
function entryUsage(entry: SessionEntry): Usage | undefined {
  if (entry.type === "branch_summary" || entry.type === "compaction") return entry.usage;
  if (entry.type !== "message") return undefined;
  if (entry.message.role === "assistant") return entry.message.usage;
  return entry.message.role === "toolResult" ? entry.message.usage : undefined;
}

/** 末条 assistant 消息的 provider（订阅判定取「当时那家」，不取当前设置里的模型） */
function assistantProvider(entry: SessionEntry): string | undefined {
  return entry.type === "message" && entry.message.role === "assistant" ? entry.message.provider : undefined;
}

function addUsage(totals: UsageTotals, usage: Usage): UsageTotals {
  return {
    input: totals.input + usage.input,
    output: totals.output + usage.output,
    cacheRead: totals.cacheRead + usage.cacheRead,
    cacheWrite: totals.cacheWrite + usage.cacheWrite,
    cost: totals.cost + usage.cost.total,
  };
}

/**
 * 会话累计用量（帧与历史响应共用同一形状）。
 * `cacheHitRate` 分母为 0 时**省略键**（不报 0%）——客户端不做缺省推断，见契约字段表。
 */
export function sessionUsage(entries: readonly SessionEntry[], options: SessionUsageOptions): ChatUsage {
  const totals = entries.reduce<UsageTotals>(
    (acc, entry) => {
      const usage = entryUsage(entry);
      return usage ? addUsage(acc, usage) : acc;
    },
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  );
  const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
  const lastProvider = entries.reduce<string | undefined>((acc, entry) => assistantProvider(entry) ?? acc, undefined);
  return {
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    cacheWrite: totals.cacheWrite,
    total: totals.input + totals.output + totals.cacheRead + totals.cacheWrite,
    cost: totals.cost,
    ...(promptTokens > 0 ? { cacheHitRate: totals.cacheRead / promptTokens } : {}),
    subscription:
      lastProvider !== undefined && (options.isUsingOAuth(lastProvider) || lastProvider === SUBSCRIPTION_PROVIDER),
  };
}
