// server：网页抓取通道实现（fetch_content 的唯一出站 HTTP 调用点）
//
// 口径（docs/api/tool-calling.md「外部检索（自动）」的 fetch_content 段、docs/design/config.md 读写边界）：
// - 凭据**只经** `getModelRuntime().getAuth("deepseek")`（与 web_search 同源）——不新增配置文件、
//   不直读 auth.json；未配置即抛可读错误（不静默失败）
// - 一次调用 = 一次上游请求：**不缓存、不重试**（是否重试由模型决定）、无多供应商回退
// - 正文不落盘、不进项目文件 / 备份 / 云端；与正文 / 参考资料没有任何写入关系
// - HTTP 走全局 `fetch`（服务启动时已安装 undici dispatcher：代理 + 连接族退避）——**不自建 Agent / 代理头**

import type { AuthResult } from "@earendil-works/pi-ai";
import type { FetchedPage, FetchPagePort } from "@whispering233/ai-editor-tools";
import { getModelRuntime } from "./model-runtime.js";

/** 抓取超时（毫秒）：整页提取比检索慢，仍要远早于「挂住整轮对话」 */
export const FETCH_TIMEOUT_MS = 30_000;

/** DeepSeek 抓取端点（单供应商，与 web_search 同一凭据） */
const FETCH_ENDPOINT = "https://api.deepseek.com/v1/tools/fetch";

/** 用户可见的凭据缺失文案（与 web-search.ts 同一份路径指引） */
const MISSING_KEY_MESSAGE = "未配置 DeepSeek API Key：设置 → 模型 → DeepSeek";

/** 凭据解析（缺省 = server 的 pi 运行时单例；测试注入 fake，绝不碰真实 auth.json） */
export type AuthResolver = (providerId: string) => Promise<AuthResult | undefined>;

export interface DeepSeekFetchOptions {
  /** 凭据来源（缺省 `getModelRuntime().getAuth`） */
  resolveAuth?: AuthResolver;
  /** 出站 fetch（缺省全局 fetch） */
  fetchImpl?: typeof fetch;
  /** 超时毫秒（缺省 `FETCH_TIMEOUT_MS`） */
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
 * 上游响应 → 抓取结果（`url` / `title` 缺失时回落到请求值：调用方已经知道抓的是哪个地址）。
 * 没有正文即失败——空正文喂给模型只会换来一次无意义的「页面打不开」猜测。
 */
function toPage(body: unknown, requestedUrl: string): FetchedPage {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const content = text(record.content);
  if (content === undefined) {
    throw new Error("网页抓取失败：上游未返回可提取的正文（该页面可能不允许抓取，或正文为空）");
  }
  const url = text(record.url) ?? requestedUrl;
  return { title: text(record.title) ?? url, url, content };
}

/**
 * DeepSeek 网页抓取通道（`ToolContext.fetchPage` 的注入值，见 `chat-runtime.ts`）。
 * 工厂只闭包配置、不在创建期联网/读凭据——每次调用才解析凭据（设置页改 key 后立即生效）。
 */
export function createDeepSeekFetch(options: DeepSeekFetchOptions = {}): FetchPagePort {
  const resolveAuth: AuthResolver =
    options.resolveAuth ?? ((providerId) => getModelRuntime().then((runtime) => runtime.getAuth(providerId)));
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;

  return {
    async fetchPage(input: { url: string }, signal?: AbortSignal): Promise<FetchedPage> {
      const auth = await resolveAuth("deepseek");
      const apiKey = auth?.auth.apiKey;
      if (apiKey === undefined || apiKey.trim() === "") throw new Error(MISSING_KEY_MESSAGE);

      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(FETCH_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: input.url }),
          signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
        });
      } catch (err) {
        if (timeout.aborted) throw new Error(`网页抓取超时（${timeoutMs} 毫秒）：DeepSeek 未在时限内响应`);
        throw new Error(`网页抓取请求失败：${describeError(err)}`);
      }

      if (!res.ok) {
        // 按码给可行动文案；**不重试、不换供应商**——失败原因直接交回模型（docs/api/tool-calling.md）
        if (res.status === 401) {
          throw new Error("DeepSeek 抓取凭据无效（HTTP 401）——请检查设置 → 模型 → DeepSeek 的 API Key");
        }
        if (res.status === 402) throw new Error("DeepSeek 账户余额不足（HTTP 402），网页抓取暂不可用");
        if (res.status === 403) {
          throw new Error("网页抓取被拒（HTTP 403）：上游安全策略不允许抓取该地址，换一个来源");
        }
        if (res.status === 404) {
          throw new Error("网页抓取失败（HTTP 404）：该地址取不到可提取的正文（链接可能已失效）");
        }
        if (res.status === 408) {
          throw new Error("网页抓取超时（HTTP 408）：上游未在时限内取回页面，换更轻的页面重试");
        }
        if (res.status === 413) {
          throw new Error("网页抓取失败（HTTP 413）：该页面正文过大，本次请求被上游拒绝");
        }
        if (res.status === 429) throw new Error("网页抓取被限流（HTTP 429）——请稍后再试，不要立刻重发");
        throw new Error(`网页抓取失败（HTTP ${res.status}）：DeepSeek 抓取接口返回错误`);
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (err) {
        throw new Error(`网页抓取响应无法解析：${describeError(err)}`);
      }
      return toPage(body, input.url);
    },
  };
}
