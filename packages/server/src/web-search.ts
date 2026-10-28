// server：联网检索通道实现（web_search 的唯一出站 HTTP 调用点）
//
// 口径（docs/api/tool-calling.md「外部检索（自动）」、docs/design/config.md 读写边界）：
// - 凭据**只经** `getModelRuntime().getAuth("deepseek")`（pi 的 provider 凭据：`auth.json` 存量优先、
//   `DEEPSEEK_API_KEY` 兜底）——不新增配置文件、不直读 auth.json；未配置即抛可读错误（不静默失败）
// - 只做检索：`need_content` 恒 false、不落盘缓存、不重试（是否重试由模型决定）、无多供应商回退
// - HTTP 走全局 `fetch`（服务启动时已安装 undici dispatcher：代理 + 连接族退避）——
//   **不自建 Agent / 代理头**，否则会丢掉全局出站行为
// - 工具层（`packages/tools`）只有 port 接口：本文件是两者的接缝，tools 不做网络与凭据

import type { AuthResult } from "@earendil-works/pi-ai";
import type { WebSearchHit, WebSearchPort, WebSearchRequest } from "@whispering233/ai-editor-tools";
import { getModelRuntime } from "./model-runtime.js";

/** 检索请求超时（毫秒）：模型等待之外还有 SSE 在途，宁可快速失败也不挂住整轮对话 */
export const SEARCH_TIMEOUT_MS = 20_000;

/** DeepSeek 搜索端点（单供应商，见卡片「不做」清单） */
const SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search";

/** 用户可见的凭据缺失文案（设置页路径与设置页字段名一致，可直接照做） */
const MISSING_KEY_MESSAGE = "未配置 DeepSeek API Key：设置 → 模型 → DeepSeek";

/** 凭据解析（缺省 = server 的 pi 运行时单例；测试注入 fake，绝不碰真实 auth.json） */
export type AuthResolver = (providerId: string) => Promise<AuthResult | undefined>;

export interface DeepSeekWebSearchOptions {
  /** 凭据来源（缺省 `getModelRuntime().getAuth`） */
  resolveAuth?: AuthResolver;
  /** 出站 fetch（缺省全局 fetch） */
  fetchImpl?: typeof fetch;
  /** 超时毫秒（缺省 `SEARCH_TIMEOUT_MS`） */
  timeoutMs?: number;
}

/** 底层网络错误 → 可读原因（undici 顶层常是笼统 `fetch failed`，诊断信息在 `cause.code`） */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { cause?: { code?: unknown } }).cause?.code;
    return typeof code === "string" && code !== "" ? `${err.message}（${code}）` : err.message;
  }
  return String(err);
}

/** 非空字符串（纯空白按空处理） */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * 权威性：上游是整数 0–4（`-1` 表示未知）⇒ 转字符串；未知即省略。
 * shortcut: 不把分档翻成文案（语义随上游调整），模型看原始值即可。
 */
function authorityText(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? String(value) : text(value);
}

/**
 * 上游结果列表：请求是「一次检索」，响应体形态未在契约里固定（数组 / `results` / `search_results`）。
 * shortcut: 只认这三个列表键，上游改形状即回落到空结果——届时改这里（并补一条解析测试）。
 */
function readItems(body: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(body)
    ? body
    : ((body as { results?: unknown; search_results?: unknown } | null)?.results ??
      (body as { search_results?: unknown } | null)?.search_results);
  return Array.isArray(raw) ? (raw.filter((item) => typeof item === "object" && item !== null) as Record<string, unknown>[]) : [];
}

/** 单条上游项 → 命中（无 url 的项丢弃：引用不了的结果没有价值） */
function toHit(item: Record<string, unknown>): WebSearchHit | null {
  const url = text(item.url);
  if (url === undefined) return null;
  return {
    title: text(item.title) ?? url,
    url,
    summary: text(item.summary) ?? text(item.content),
    snippet: text(item.snippet),
    date: text(item.date),
    authority: authorityText(item.authority),
  };
}

/**
 * DeepSeek 联网检索通道（`ToolContext.webSearch` 的注入值，见 `chat-runtime.ts`）。
 * 工厂只闭包配置、不在创建期联网/读凭据——每次调用才解析凭据（设置页改 key 后立即生效）。
 */
export function createDeepSeekWebSearch(options: DeepSeekWebSearchOptions = {}): WebSearchPort {
  const resolveAuth: AuthResolver =
    options.resolveAuth ?? ((providerId) => getModelRuntime().then((runtime) => runtime.getAuth(providerId)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;

  return {
    async search(input: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchHit[]> {
      const auth = await resolveAuth("deepseek");
      const apiKey = auth?.auth.apiKey;
      if (apiKey === undefined || apiKey.trim() === "") throw new Error(MISSING_KEY_MESSAGE);

      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(SEARCH_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: input.query, count: input.count, need_content: false }),
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
      } catch (err) {
        if (timeout.aborted) throw new Error(`联网检索超时（${timeoutMs} 毫秒）：DeepSeek 未在时限内响应`);
        throw new Error(`联网检索请求失败：${describeError(err)}`);
      }

      if (!res.ok) {
        // 按码给可行动文案；**不重试、不换供应商**——失败原因直接交回模型（docs/api/tool-calling.md）
        if (res.status === 401) {
          throw new Error(`DeepSeek 搜索凭据无效（HTTP 401）——请检查设置 → 模型 → DeepSeek 的 API Key`);
        }
        if (res.status === 402) throw new Error("DeepSeek 账户余额不足（HTTP 402），联网检索暂不可用");
        if (res.status === 429) throw new Error("联网检索被限流（HTTP 429）——请稍后再试，不要立刻重发");
        throw new Error(`联网检索失败（HTTP ${res.status}）：DeepSeek 搜索接口返回错误`);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        throw new Error(`联网检索响应无法解析：${describeError(err)}`);
      }
      return readItems(body)
        .map(toHit)
        .filter((hit): hit is WebSearchHit => hit !== null);
    },
  };
}
