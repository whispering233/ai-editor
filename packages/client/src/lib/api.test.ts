// lib/api 端点函数测试（S1.4）：create/open/close project + settings/llm
// 用 mock fetch 验证请求路径/方法/body 形状与响应解析（含 open 的 rebuilt 透传）
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  CLIENT_NETWORK_ERROR,
  closeProject,
  createProject,
  getSettingsLlm,
  listProjects,
  openProject,
  updateSettingsLlm,
} from "./api";

const originalFetch = globalThis.fetch;

/** mock fetch：记录请求参数，返回给定响应 */
function mockFetchOnce(response: { status?: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("createProject（POST /api/v1/project/create）", () => {
  it("请求方法/路径/body 形状（path + config，snake_case）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { id: "proj-1", path: "/tmp/p", created: true } } });
    const res = await createProject("/tmp/p", { name: "我的小说", language: "zh" });
    expect(res).toEqual({ id: "proj-1", path: "/tmp/p", created: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/v1/project/create");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      path: "/tmp/p",
      config: { name: "我的小说", language: "zh" },
    });
  });

  it("不传 config 时请求体不含 config 键", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { id: "proj-1", path: "/tmp/p", created: true } } });
    await createProject("/tmp/p");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: "/tmp/p" });
  });

  it("409 PROJECT_ALREADY_EXISTS → 抛 ApiError（code 透传）", async () => {
    mockFetchOnce({
      status: 409,
      body: { success: false, error: { code: "PROJECT_ALREADY_EXISTS", message: "目录已是项目" } },
    });
    await expect(createProject("/tmp/p")).rejects.toMatchObject({
      code: "PROJECT_ALREADY_EXISTS",
      message: "目录已是项目",
    });
  });
});

describe("openProject（POST /api/v1/project/open）", () => {
  it("请求 body { path }；响应透传 config 与 rebuilt/fromVersion", async () => {
    const config = {
      id: "proj-1",
      name: "我的小说",
      language: "zh",
      prompt: "",
      schemaVersion: 1,
      currentPosition: null,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:00:00Z",
    };
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: { id: "proj-1", name: "我的小说", language: "zh", config, rebuilt: true, fromVersion: 0 },
      },
    });
    const res = await openProject("/tmp/p");
    expect(res.rebuilt).toBe(true);
    expect(res.fromVersion).toBe(0);
    expect(res.config.name).toBe("我的小说");
    expect(calls[0].url).toBe("/api/v1/project/open");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ path: "/tmp/p" });
  });

  it("400 INVALID_PROJECT_PATH → 抛 ApiError", async () => {
    mockFetchOnce({
      status: 400,
      body: { success: false, error: { code: "INVALID_PROJECT_PATH", message: "路径不存在" } },
    });
    await expect(openProject("/nope")).rejects.toMatchObject({ code: "INVALID_PROJECT_PATH" });
  });
});

describe("closeProject（POST /api/v1/project/close）", () => {
  it("无 body；返回 { saved: true }", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { saved: true } } });
    await expect(closeProject()).resolves.toEqual({ saved: true });
    expect(calls[0].url).toBe("/api/v1/project/close");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });
});

describe("listProjects（GET /api/v1/project/list，S1.5 书架）", () => {
  it("请求路径与方法；响应解析 rootPath + books（name/path/updatedAt）", async () => {
    const calls = mockFetchOnce({
      body: {
        success: true,
        data: {
          rootPath: "/home/me/novels",
          books: [
            { name: "我的小说", path: "/home/me/novels/books/我的小说", updatedAt: "2026-08-01T22:30:00Z" },
            { name: "第二本", path: "/home/me/novels/books/第二本", updatedAt: "2026-07-30T10:12:00Z" },
          ],
        },
      },
    });
    const res = await listProjects();
    expect(res.rootPath).toBe("/home/me/novels");
    expect(res.books).toHaveLength(2);
    expect(res.books[0]).toEqual({
      name: "我的小说",
      path: "/home/me/novels/books/我的小说",
      updatedAt: "2026-08-01T22:30:00Z",
    });
    expect(calls[0].url).toBe("/api/v1/project/list");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("空书架 → books 空数组（空态「还没有书」）", async () => {
    mockFetchOnce({ body: { success: true, data: { rootPath: "/home/me/novels", books: [] } } });
    const res = await listProjects();
    expect(res.books).toEqual([]);
  });
});

describe("settings/llm（S1.3 端点）", () => {
  it("getSettingsLlm：GET /settings/llm 返回 model/apiKeySet/apiKeyMasked", async () => {
    const calls = mockFetchOnce({
      body: { success: true, data: { model: "deepseek-v4-flash", apiKeySet: true, apiKeyMasked: "sk-****1234" } },
    });
    const res = await getSettingsLlm();
    expect(res).toEqual({ model: "deepseek-v4-flash", apiKeySet: true, apiKeyMasked: "sk-****1234" });
    expect(calls[0].url).toBe("/api/v1/settings/llm");
    expect(calls[0].init?.method).toBe("GET");
  });

  it("updateSettingsLlm：PUT body snake_case；api_key 空串透传（清除语义）", async () => {
    const calls = mockFetchOnce({ body: { success: true, data: { saved: true } } });
    await updateSettingsLlm({ api_key: "" });
    expect(calls[0].url).toBe("/api/v1/settings/llm");
    expect(calls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ api_key: "" });
  });

  it("网络失败 → 抛 CLIENT_NETWORK_ERROR", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(getSettingsLlm()).rejects.toMatchObject({ code: CLIENT_NETWORK_ERROR });
    // ApiError 类型断言（code 字段可访问）
    try {
      await getSettingsLlm();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
    }
  });
});
