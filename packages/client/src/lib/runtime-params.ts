// 设置页「高级 → 运行参数」的文本口径（纯函数，可测）
//
// 一张表单管 `settings.json` 的三个键：`retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs`。
// 读 = 严格 `JSON.parse`（`settings.json` 是严格 JSON，与服务端写入前的校验口径一致），
// 写 = 原文 → 只改这三项 → stringify：`retry` / `compaction` 是嵌套对象 ⇒ **浅合并**，
// 否则表单保存会把用户手写的 `maxRetries` / `reserveTokens` 与顶层未知键一起抹掉。
//
// 约束来源 = pi `schemas/settings.schema.json` + `dist/core/settings-manager.js`（不许凭记忆）：
// - `retry.enabled` / `compaction.enabled`：可选 boolean（缺省值归 pi，客户端不知道 ⇒ 「默认」= 删键）
// - `httpIdleTimeoutMs`：`Type.Number({ minimum: 0 })` 或字面量 `"disabled"`；
//   `SettingsManager.setHttpIdleTimeoutMs` 只拒 `< 0`，getter 把 0 当「关闭空闲超时」
// ⇒ 表单能写的是**数字毫秒、下界 0**；字符串形态 `"disabled"` 表单不表达，读到时指路下方 JSON。
export interface RuntimeParams {
  retryEnabled: boolean | undefined;
  compactionEnabled: boolean | undefined;
  httpIdleTimeoutMs: number | undefined;
}

/** pi schema 里 `httpIdleTimeoutMs` 的下界；0 = 关闭空闲超时 */
export const HTTP_IDLE_TIMEOUT_MIN_MS = 0;

export const EMPTY_RUNTIME_PARAMS: RuntimeParams = {
  retryEnabled: undefined,
  compactionEnabled: undefined,
  httpIdleTimeoutMs: undefined,
};

/** 读成功时带出原文对象（写回要用它保住其它字段） */
export type RuntimeParamsParseResult =
  | { ok: true; params: RuntimeParams; original: Record<string, unknown> }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 表单侧校验（读文件与保存前共用）：合法返回 null。下界由 schema 常量插值，不手抄数字 */
export function httpIdleTimeoutProblem(value: number): string | null {
  if (Number.isInteger(value) && value >= HTTP_IDLE_TIMEOUT_MIN_MS) return null;
  return `空闲超时必须是不小于 ${HTTP_IDLE_TIMEOUT_MIN_MS} 的整数毫秒（${HTTP_IDLE_TIMEOUT_MIN_MS} = 关闭空闲超时）`;
}

type FlagResult = { ok: true; value: boolean | undefined } | { ok: false; reason: string };

/** `<key>.enabled`：容器缺省 = undefined；容器非对象 / enabled 非 boolean = reason */
function readFlag(original: Record<string, unknown>, key: "retry" | "compaction"): FlagResult {
  const container = original[key];
  if (container === undefined) return { ok: true, value: undefined };
  if (!isRecord(container)) return { ok: false, reason: `${key} 必须是对象` };
  const enabled = container.enabled;
  if (enabled === undefined) return { ok: true, value: undefined };
  if (typeof enabled !== "boolean") return { ok: false, reason: `${key}.enabled 只能是 true / false` };
  return { ok: true, value: enabled };
}

type TimeoutResult = { ok: true; value: number | undefined } | { ok: false; reason: string };

function readHttpIdleTimeout(raw: unknown): TimeoutResult {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "number") {
    // pi 的 getter 认 `"disabled"`（等价 0）与数字字符串；表单只写数字，不替用户翻译
    return {
      ok: false,
      reason: `httpIdleTimeoutMs 只能是数字毫秒（pi 也接受字符串 "disabled"，等价于 ${HTTP_IDLE_TIMEOUT_MIN_MS}）`,
    };
  }
  const problem = httpIdleTimeoutProblem(raw);
  return problem === null ? { ok: true, value: raw } : { ok: false, reason: problem };
}

/** 文件文本 → 三个值（空文本 / 空对象 = 三项皆缺省） */
export function readRuntimeParams(text: string): RuntimeParamsParseResult {
  if (text.trim() === "") return { ok: true, params: EMPTY_RUNTIME_PARAMS, original: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `不是合法 JSON（${err instanceof Error ? err.message : "解析失败"}）` };
  }
  if (!isRecord(parsed)) return { ok: false, reason: "顶层必须是 JSON 对象" };

  const retry = readFlag(parsed, "retry");
  if (!retry.ok) return retry;
  const compaction = readFlag(parsed, "compaction");
  if (!compaction.ok) return compaction;
  const httpIdleTimeoutMs = readHttpIdleTimeout(parsed.httpIdleTimeoutMs);
  if (!httpIdleTimeoutMs.ok) return httpIdleTimeoutMs;

  return {
    ok: true,
    params: {
      retryEnabled: retry.value,
      compactionEnabled: compaction.value,
      httpIdleTimeoutMs: httpIdleTimeoutMs.value,
    },
    original: parsed,
  };
}

/** 只改 `<key>.enabled`：其它字段原样保留；`undefined` = 删键（删空了就连容器一起删） */
function applyFlag(next: Record<string, unknown>, key: "retry" | "compaction", enabled: boolean | undefined): void {
  const container = isRecord(next[key]) ? { ...next[key] } : {};
  if (enabled === undefined) delete container.enabled;
  else container.enabled = enabled;
  if (Object.keys(container).length === 0) delete next[key];
  else next[key] = container;
}

/** 原文 + 三个值 → 整份文本（浅合并；字段顺序沿用原文，新键追加在后） */
export function composeSettingsText(original: Record<string, unknown>, params: RuntimeParams): string {
  const next = { ...original };
  applyFlag(next, "retry", params.retryEnabled);
  applyFlag(next, "compaction", params.compactionEnabled);
  if (params.httpIdleTimeoutMs === undefined) delete next.httpIdleTimeoutMs;
  else next.httpIdleTimeoutMs = params.httpIdleTimeoutMs;
  return JSON.stringify(next, null, 2);
}