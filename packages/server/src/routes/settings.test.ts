// 设置路由测试（S1.3）：GET/PUT /api/v1/settings/llm
// 隔离策略：临时 HOME（os.tmpdir + mkdtemp）——用户级配置写入/读取不出测试沙箱；
// 环境变量 DEEPSEEK_API_KEY 在每个用例前后设置/恢复
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import { DEEPSEEK_API_KEY_ENV, settingsRoutes, userConfigPath } from "./settings.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" }; // 来源校验 host 白名单（决策 17 修订）

/** 组装带错误处理的测试 app（settings 路由 + 统一错误包裹） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.route("/api/v1/settings", settingsRoutes);
  return app;
}

let homeDir: string;
let originalHome: string | undefined;
let originalKey: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  originalKey = process.env.DEEPSEEK_API_KEY;
  homeDir = mkdtempSync(join(tmpdir(), "ai-editor-home-"));
  process.env.HOME = homeDir; // HOME 可覆盖（用户级配置隔离）
  delete process.env[DEEPSEEK_API_KEY_ENV];
});

afterEach(() => {
  delete process.env[DEEPSEEK_API_KEY_ENV];
  if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(homeDir, { recursive: true, force: true });
});

/** 预写用户级配置文件（模拟已保存的 key/model） */
function seedConfig(config: Record<string, unknown>): void {
  const file = userConfigPath();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(config), "utf8");
}

describe("GET /api/v1/settings/llm", () => {
  it("无任何配置 → 默认模型 + thinkingLevel=high + apiKeySet=false + 模型目录（决策 34）", async () => {
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.model).toBe("deepseek-v4-flash");
    expect(body.data.thinkingLevel).toBe("high");
    expect(body.data.apiKeySet).toBe(false);
    expect(body.data.apiKeyMasked).toBeUndefined();
    expect(Array.isArray(body.data.models)).toBe(true);
    expect(body.data.models.length).toBeGreaterThan(0);
    expect(body.data.models[0]).toMatchObject({ id: expect.any(String), contextWindow: expect.any(Number) });
  });

  it("环境变量 DEEPSEEK_API_KEY → apiKeySet=true + 掩码 sk-****1234 形状", async () => {
    process.env[DEEPSEEK_API_KEY_ENV] = "sk-abcdefghijkl1234";
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = await res.json();
    expect(body.data.model).toBe("deepseek-v4-flash");
    expect(body.data.apiKeySet).toBe(true);
    expect(body.data.apiKeyMasked).toBe("sk-****1234");
    expect(Array.isArray(body.data.models)).toBe(true);
  });

  it("config.json 有 key（无环境变量）→ apiKeySet=true", async () => {
    seedConfig({ api_key: "sk-secretkey123456" });
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { apiKeySet: boolean; apiKeyMasked: string } };
    expect(body.data.apiKeySet).toBe(true);
    expect(body.data.apiKeyMasked).toBe("sk-****3456"); // 前 3 后 4
  });

  it("环境变量优先于 config.json（两者都有 → 掩码来自环境变量，决策 17）", async () => {
    process.env[DEEPSEEK_API_KEY_ENV] = "sk-envkeyabcdefgh"; // 17 字符：前3 sk- + **** + 后4 efgh
    seedConfig({ api_key: "sk-filekey12345678" });
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { apiKeyMasked: string } };
    expect(body.data.apiKeyMasked).toBe("sk-****efgh"); // 来自 env 的 sk-envkeyabcdefgh
  });

  it("config.json 的 model 被读取（默认值覆盖）", async () => {
    seedConfig({ model: "deepseek-r1" });
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { model: string } };
    expect(body.data.model).toBe("deepseek-r1");
  });

  it("config.json 损坏（非法 JSON）→ 降级为默认值（不抛错）", async () => {
    seedConfig({ broken: true });
    const file = userConfigPath();
    writeFileSync(file, "{not-json", "utf8");
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { apiKeySet: boolean } };
    expect(body.data.apiKeySet).toBe(false);
  });
});

describe("PUT /api/v1/settings/llm", () => {
  it("写入 model → GET 读回；config.json 落在临时 HOME 下", async () => {
    const put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-v4-flash" }) },
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ success: true, data: { saved: true } });

    const get = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await get.json()) as { data: { model: string } };
    expect(body.data.model).toBe("deepseek-v4-flash");
    // 写入位置：临时 HOME 下（真实用户 HOME 不受污染）
    const onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as { model: string };
    expect(onDisk.model).toBe("deepseek-v4-flash");
  });

  it("写入 api_key → GET apiKeySet=true + 掩码正确", async () => {
    const put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ api_key: "sk-abcdefgh1234" }) },
    );
    expect(put.status).toBe(200);

    const get = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await get.json()) as { data: { apiKeySet: boolean; apiKeyMasked: string } };
    expect(body.data.apiKeySet).toBe(true);
    expect(body.data.apiKeyMasked).toBe("sk-****1234");
  });

  it("api_key 空字符串 = 清除已保存 key（config.json 中键被删除）", async () => {
    seedConfig({ api_key: "sk-abcdefgh1234", model: "deepseek-v4-flash" });
    const put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ api_key: "" }) },
    );
    expect(put.status).toBe(200);

    const get = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await get.json()) as { data: { apiKeySet: boolean; apiKeyMasked?: string } };
    expect(body.data.apiKeySet).toBe(false);
    expect(body.data.apiKeyMasked).toBeUndefined();
    const onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as Record<string, unknown>;
    expect("api_key" in onDisk).toBe(false);
    expect(onDisk.model).toBe("deepseek-v4-flash"); // 其他字段保留
  });

  it("非法入参 → 400 VALIDATION_ERROR（strict：未知顶层键拒绝）", async () => {
    const res = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ model: 42 }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");

    const res2 = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ apiKey: "sk-xxx" }) },
    );
    expect(res2.status).toBe(400);
  });

  it("空 body（非法 JSON）→ 400 VALIDATION_ERROR", async () => {
    const res = await buildApp().request("/api/v1/settings/llm", { method: "PUT", headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("掩码格式（shared utils maskApiKey 集成）", () => {
  it("sk-****1234 形状（前 3 后 4）", async () => {
    process.env[DEEPSEEK_API_KEY_ENV] = "sk-abcdefgh1234";
    const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
    const body = (await res.json()) as { data: { apiKeyMasked: string } };
    expect(body.data.apiKeyMasked).toMatch(/^sk-\*\*\*\*1234$/);
  });
});
