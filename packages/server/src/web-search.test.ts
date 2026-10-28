// server 联网检索通道单测（createDeepSeekWebSearch）
// 覆盖：请求形状（URL / Authorization / body / 不返正文）、结果投影（两种列表形态 + 无 url 丢弃）、
// 缺凭据文案（不调 fetch）、401/402/429/5xx 文案、网络错误原因、超时中止、调用方中止。
// **零真实网络**：fetch 与凭据解析都是注入的 fake。
import { describe, expect, it, vi } from "vitest";
import type { AuthResult } from "@earendil-works/pi-ai";
import { createDeepSeekWebSearch, SEARCH_TIMEOUT_MS } from "./web-search.js";

const AUTH: AuthResult = { auth: { apiKey: "sk-test" }, source: "DEEPSEEK_API_KEY" };

/** 永不返回的 fetch：只在 signal 中止时拒绝（测超时与调用方中止两条路径） */
const hangingFetch = (async (_url: string, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    if (init?.signal?.aborted === true) reject(new Error("aborted"));
    else init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as unknown as typeof fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(options: { auth?: AuthResult; response?: Response; fetchImpl?: typeof fetch } = {}) {
  const fetchImpl =
    options.fetchImpl ??
    (vi.fn(async () => options.response ?? jsonResponse([])) as unknown as typeof fetch);
  return {
    fetchMock: fetchImpl as unknown as ReturnType<typeof vi.fn>,
    port: createDeepSeekWebSearch({
      resolveAuth: async () => options.auth ?? AUTH,
      fetchImpl,
      timeoutMs: SEARCH_TIMEOUT_MS,
    }),
  };
}

describe("createDeepSeekWebSearch", () => {
  it("请求形状：DeepSeek 搜索端点 + Bearer 凭据 + query/count + need_content 恒 false", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    const port = createDeepSeekWebSearch({ resolveAuth: async () => AUTH, fetchImpl });
    await port.search({ query: "site:nature.com 气候", count: 5 });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1); // 一次检索 = 一次 fetch（无重试链）
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    // count 由工具层填缺省后透传（缺省值断言见 tools 包 web-search.test.ts）；正文一律不取
    expect(JSON.parse(init.body as string)).toEqual({ query: "site:nature.com 气候", count: 5, need_content: false });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("结果投影：数组 / search_results 两种形态都认；无 url 的项丢弃；正文 content 回落 summary", async () => {
    const hits = [
      { title: "A", url: "https://a.example", content: "正文摘要 A", date: "2026-09-01", authority: 3 },
      { title: "无链接", summary: "丢弃" },
      { title: "B", url: "https://b.example", summary: "摘要 B", snippet: "片段 B", authority: -1 },
    ];
    const asArray = client({ response: jsonResponse(hits) });
    expect(await asArray.port.search({ query: "q", count: 3 })).toEqual([
      // authority 上游是整数 0–4（-1 = 未知）⇒ 转字符串 / 未知省略
      { title: "A", url: "https://a.example", summary: "正文摘要 A", snippet: undefined, date: "2026-09-01", authority: "3" },
      { title: "B", url: "https://b.example", summary: "摘要 B", snippet: "片段 B", date: undefined, authority: undefined },
    ]);

    const asWrapped = client({ response: jsonResponse({ search_results: hits }) });
    expect(await asWrapped.port.search({ query: "q", count: 3 })).toHaveLength(2);
  });

  it("未配置凭据：抛设置页可照做的文案，且不发请求", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    const port = createDeepSeekWebSearch({ resolveAuth: async () => undefined, fetchImpl });
    await expect(port.search({ query: "q", count: 1 })).rejects.toThrow("未配置 DeepSeek API Key：设置 → 模型 → DeepSeek");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toEqual([]);
  });

  it("凭据是空串同样按未配置处理", async () => {
    const port = createDeepSeekWebSearch({ resolveAuth: async () => ({ auth: { apiKey: "   " } }) });
    await expect(port.search({ query: "q", count: 1 })).rejects.toThrow(/未配置 DeepSeek API Key/);
  });

  it.each([
    [401, /凭据无效（HTTP 401）/],
    [402, /余额不足（HTTP 402）/],
    [429, /限流（HTTP 429）/],
    [500, /联网检索失败（HTTP 500）/],
    [503, /联网检索失败（HTTP 503）/],
  ])("HTTP %i → 可读文案且不重试", async (status, expected) => {
    const current = client({ response: jsonResponse({ error: "x" }, status) });
    await expect(current.port.search({ query: "q", count: 1 })).rejects.toThrow(expected);
    expect(current.fetchMock.mock.calls).toHaveLength(1); // 无重试链（是否重试由模型决定）
  });

  it("网络错误：带上 undici 的 cause.code（笼统 fetch failed 之外的可诊断原因）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }) as unknown as typeof fetch;
    const port = createDeepSeekWebSearch({ resolveAuth: async () => AUTH, fetchImpl });
    await expect(port.search({ query: "q", count: 1 })).rejects.toThrow("联网检索请求失败：fetch failed（ENOTFOUND）");
  });

  it("超时中止：SEARCH_TIMEOUT_MS 到点即失败（不挂住整轮对话）", async () => {
    const port = createDeepSeekWebSearch({ resolveAuth: async () => AUTH, fetchImpl: hangingFetch, timeoutMs: 5 });
    await expect(port.search({ query: "q", count: 1 })).rejects.toThrow(/联网检索超时（5 毫秒）/);
  });

  it("调用方中止（工具被取消）不是超时：报请求失败并说明原因", async () => {
    const port = createDeepSeekWebSearch({ resolveAuth: async () => AUTH, fetchImpl: hangingFetch, timeoutMs: 60_000 });
    const controller = new AbortController();
    const pending = port.search({ query: "q", count: 1 }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0)); // 让请求真的发出去（listen 已挂上）
    controller.abort();
    await expect(pending).rejects.toThrow(/联网检索请求失败/);
  });

  it("响应不是 JSON：报可读解析错误", async () => {
    const port = createDeepSeekWebSearch({
      resolveAuth: async () => AUTH,
      fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch,
    });
    await expect(port.search({ query: "q", count: 1 })).rejects.toThrow(/联网检索响应无法解析/);
  });
});
