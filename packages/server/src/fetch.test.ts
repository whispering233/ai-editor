// server 网页抓取通道单测（createDeepSeekFetch）
// 覆盖：请求形状（URL / Authorization / body）、响应投影与回落、缺凭据文案（不调 fetch）、
// 401/402/403/404/408/413/429/5xx 文案、空正文报错、网络错误原因、超时中止、调用方中止、非 JSON 响应。
// **零真实网络**：fetch 与凭据解析都是注入的 fake。
import { describe, expect, it, vi } from "vitest";
import type { AuthResult } from "@earendil-works/pi-ai";
import { createDeepSeekFetch, FETCH_TIMEOUT_MS } from "./fetch.js";

const AUTH: AuthResult = { auth: { apiKey: "sk-test" }, source: "DEEPSEEK_API_KEY" };
const REQUESTED = "https://example.com/article";

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
    (vi.fn(async () => options.response ?? jsonResponse({ title: "T", url: REQUESTED, content: "正文" })) as unknown as typeof fetch);
  return {
    fetchMock: fetchImpl as unknown as ReturnType<typeof vi.fn>,
    port: createDeepSeekFetch({
      resolveAuth: async () => options.auth ?? AUTH,
      fetchImpl,
      timeoutMs: FETCH_TIMEOUT_MS,
    }),
  };
}

describe("createDeepSeekFetch", () => {
  it("请求形状：DeepSeek 抓取端点 + Bearer 凭据 + 仅 url", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ title: "T", url: REQUESTED, content: "正文" })) as unknown as typeof fetch;
    const port = createDeepSeekFetch({ resolveAuth: async () => AUTH, fetchImpl });
    await port.fetchPage({ url: REQUESTED });

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1); // 一次抓取 = 一次 fetch（无缓存、无重试链）
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/tools/fetch");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ url: REQUESTED });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("响应投影：title/url/content 原样；缺 title/url 回落到请求地址", async () => {
    const full = client({ response: jsonResponse({ title: "示例页", url: REQUESTED, content: "正文" }) });
    expect(await full.port.fetchPage({ url: REQUESTED })).toEqual({
      title: "示例页",
      url: REQUESTED,
      content: "正文",
    });

    const bare = client({ response: jsonResponse({ content: "只有正文" }) });
    expect(await bare.port.fetchPage({ url: REQUESTED })).toEqual({
      title: REQUESTED,
      url: REQUESTED,
      content: "只有正文",
    });
  });

  it("上游无正文：报可读错误（不返回空 content 让模型猜）", async () => {
    const empty = client({ response: jsonResponse({ title: "T", url: REQUESTED }) });
    await expect(empty.port.fetchPage({ url: REQUESTED })).rejects.toThrow(/未返回可提取的正文/);

    const blank = client({ response: jsonResponse({ title: "T", url: REQUESTED, content: "   " }) });
    await expect(blank.port.fetchPage({ url: REQUESTED })).rejects.toThrow(/未返回可提取的正文/);
  });

  it("未配置凭据：抛设置页可照做的文案，且不发请求", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: "x" })) as unknown as typeof fetch;
    const port = createDeepSeekFetch({ resolveAuth: async () => undefined, fetchImpl });
    await expect(port.fetchPage({ url: REQUESTED })).rejects.toThrow("未配置 DeepSeek API Key：设置 → 模型 → DeepSeek");
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toEqual([]);
  });

  it("凭据是空串同样按未配置处理", async () => {
    const port = createDeepSeekFetch({ resolveAuth: async () => ({ auth: { apiKey: "   " } }) });
    await expect(port.fetchPage({ url: REQUESTED })).rejects.toThrow(/未配置 DeepSeek API Key/);
  });

  it.each([
    [401, /凭据无效（HTTP 401）/],
    [402, /余额不足（HTTP 402）/],
    [403, /被拒（HTTP 403）/],
    [404, /网页抓取失败（HTTP 404）：该地址取不到可提取的正文/],
    [408, /超时（HTTP 408）/],
    [413, /网页抓取失败（HTTP 413）：该页面正文过大/],
    [429, /限流（HTTP 429）/],
    [500, /网页抓取失败（HTTP 500）/],
    [503, /网页抓取失败（HTTP 503）/],
  ])("HTTP %i → 可读文案且不重试", async (status, expected) => {
    const current = client({ response: jsonResponse({ error: "x" }, status) });
    await expect(current.port.fetchPage({ url: REQUESTED })).rejects.toThrow(expected);
    expect(current.fetchMock.mock.calls).toHaveLength(1); // 无重试链（是否重试由模型决定）
  });

  it("网络错误：带上 undici 的 cause.code（笼统 fetch failed 之外的可诊断原因）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }) as unknown as typeof fetch;
    const port = createDeepSeekFetch({ resolveAuth: async () => AUTH, fetchImpl });
    await expect(port.fetchPage({ url: REQUESTED })).rejects.toThrow("网页抓取请求失败：fetch failed（ENOTFOUND）");
  });

  it("超时中止：FETCH_TIMEOUT_MS 到点即失败（不挂住整轮对话）", async () => {
    const port = createDeepSeekFetch({ resolveAuth: async () => AUTH, fetchImpl: hangingFetch, timeoutMs: 5 });
    await expect(port.fetchPage({ url: REQUESTED })).rejects.toThrow(/网页抓取超时（5 毫秒）/);
  });

  it("调用方中止（工具被取消）不是超时：报请求失败并说明原因", async () => {
    const port = createDeepSeekFetch({ resolveAuth: async () => AUTH, fetchImpl: hangingFetch, timeoutMs: 60_000 });
    const controller = new AbortController();
    const pending = port.fetchPage({ url: REQUESTED }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0)); // 让请求真的发出去（listen 已挂上）
    controller.abort();
    await expect(pending).rejects.toThrow(/网页抓取请求失败/);
  });

  it("响应不是 JSON：报可读解析错误", async () => {
    const port = createDeepSeekFetch({
      resolveAuth: async () => AUTH,
      fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch,
    });
    await expect(port.fetchPage({ url: REQUESTED })).rejects.toThrow(/网页抓取响应无法解析/);
  });
});
