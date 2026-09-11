// 设置路由测试（S1.3 + 多 provider）：GET/PUT /api/v1/settings/llm
// 隔离策略：临时 HOME（os.tmpdir + mkdtemp）——用户级配置 + pi-agent auth 读写不出测试沙箱；
// 各 provider 环境变量在每个用例前后设置/恢复
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import {
  DEEPSEEK_API_KEY_ENV,
  OPENCODE_API_KEY_ENV,
  getContextBudget,
  piAgentAuthPath,
  resolveContextBudgets,
  settingsRoutes,
  userConfigPath,
} from "./settings.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" }; // 来源校验 host 白名单

/** 组装带错误处理的测试 app（settings 路由 + 统一错误包裹） */
function buildApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler());
  app.route("/api/v1/settings", settingsRoutes);
  return app;
}

let homeDir: string;
let originalHome: string | undefined;
const ORIGINAL_ENVS: Record<string, string | undefined> = {};

const ENVS = [DEEPSEEK_API_KEY_ENV, OPENCODE_API_KEY_ENV] as const;

beforeEach(() => {
  originalHome = process.env.HOME;
  for (const e of ENVS) ORIGINAL_ENVS[e] = process.env[e];
  homeDir = mkdtempSync(join(tmpdir(), "ai-editor-home-"));
  process.env.HOME = homeDir; // HOME 可覆盖（用户级配置/pi-agent auth 隔离）
  for (const e of ENVS) delete process.env[e];
});

afterEach(() => {
  for (const e of ENVS) {
    const v = ORIGINAL_ENVS[e];
    if (v !== undefined) process.env[e] = v;
    else delete process.env[e];
  }
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

/** 预写 pi-agent auth.json（只读兜底来源） */
function seedPiAuth(auth: unknown): void {
  const file = piAgentAuthPath();
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(auth), "utf8");
}

async function getData(): Promise<{ data: Record<string, unknown> }> {
  const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  return (await res.json()) as { data: Record<string, unknown> };
}

interface ProviderEntry {
  id: string;
  displayName: string;
  apiKeySet: boolean;
  apiKeyMasked?: string;
  models: Array<{ id: string; provider: string; contextWindow: number }>;
}

describe("GET /api/v1/settings/llm（多 provider）", () => {
  it("无任何配置 → 激活 deepseek + 默认模型；providers 两卡（deepseek 2 模型 / opencode-go 17 模型）均 apiKeySet=false", async () => {
    const { data } = await getData();
    expect(data.provider).toBe("deepseek");
    expect(data.model).toBe("deepseek-v4-flash");
    expect(data.thinkingLevel).toBe("high");
    const providers = data.providers as ProviderEntry[];
    expect(providers.map((p) => p.id)).toEqual(["deepseek", "opencode-go"]);
    const deep = providers[0];
    expect(deep.displayName).toBe("DeepSeek");
    expect(deep.apiKeySet).toBe(false);
    expect(deep.apiKeyMasked).toBeUndefined();
    expect(deep.models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    const og = providers[1];
    expect(og.apiKeySet).toBe(false);
    // opencode-go 目录含撞名模型（provider 消歧基础）与订阅专属模型
    const ogIds = og.models.map((m) => m.id);
    expect(ogIds).toContain("deepseek-v4-flash");
    expect(ogIds).toContain("qwen3.7-max");
    expect(og.models.find((m) => m.id === "qwen3.7-max")).toMatchObject({ provider: "opencode-go" });
  });

  it("DEEPSEEK_API_KEY env → deepseek 卡 set + 掩码；opencode-go 卡仍 false", async () => {
    process.env[DEEPSEEK_API_KEY_ENV] = "sk-abcdefghijkl1234";
    const { data } = await getData();
    const providers = data.providers as ProviderEntry[];
    expect(providers[0].apiKeySet).toBe(true);
    expect(providers[0].apiKeyMasked).toBe("sk-****1234");
    expect(providers[1].apiKeySet).toBe(false);
  });

  it("OPENCODE_API_KEY env → opencode-go 卡 set + 掩码", async () => {
    process.env[OPENCODE_API_KEY_ENV] = "oc-abcdefghijkl1234";
    const { data } = await getData();
    const providers = data.providers as ProviderEntry[];
    expect(providers[0].apiKeySet).toBe(false);
    expect(providers[1].apiKeySet).toBe(true);
    expect(providers[1].apiKeyMasked).toBe("oc-****1234");
  });

  it("config v2 api_keys → 各家卡状态；v1 旧 api_key 字段视为 deepseek 卡", async () => {
    seedConfig({ schema_version: 2, api_keys: { "opencode-go": "oc-filekey12345678" } });
    let providers = ((await getData()).data.providers as ProviderEntry[]);
    expect(providers[1].apiKeySet).toBe(true);
    expect(providers[1].apiKeyMasked).toBe("oc-****5678");

    seedConfig({ schema_version: 1, api_key: "sk-legacykey123456" });
    providers = ((await getData()).data.providers as ProviderEntry[]);
    expect(providers[0].apiKeySet).toBe(true);
    expect(providers[0].apiKeyMasked).toBe("sk-****3456");
    expect(providers[1].apiKeySet).toBe(false);
  });

  it("config api_keys 显式空串 = 清除该家（不回落到 v1 旧 api_key）", async () => {
    seedConfig({ api_key: "sk-legacykey123456", api_keys: { deepseek: "" } });
    const providers = ((await getData()).data.providers as ProviderEntry[]);
    expect(providers[0].apiKeySet).toBe(false);
  });

  it("pi-agent auth.json 只读兜底：opencode-go 条目 api_key 生效；非法/缺项跳过", async () => {
    seedPiAuth({ "opencode-go": { type: "api_key", key: "oc-piagentkey123456" } });
    const providers = ((await getData()).data.providers as ProviderEntry[]);
    expect(providers[1].apiKeySet).toBe(true);
    expect(providers[1].apiKeyMasked).toBe("oc-****3456");

    // 非法形态：type 非 api_key / key 非字符串 / 文件损坏 / 无该项 → 跳过
    seedPiAuth({ "opencode-go": { type: "oauth", key: "oc-x" } });
    expect((((await getData()).data.providers as ProviderEntry[])[1]).apiKeySet).toBe(false);
    seedPiAuth({ "opencode-go": { type: "api_key", key: 42 } });
    expect((((await getData()).data.providers as ProviderEntry[])[1]).apiKeySet).toBe(false);
    seedPiAuth("{not-json");
    expect((((await getData()).data.providers as ProviderEntry[])[1]).apiKeySet).toBe(false);
    seedPiAuth({});
    expect((((await getData()).data.providers as ProviderEntry[])[1]).apiKeySet).toBe(false);
  });

  it("config.json 的 provider/model/thinking_level 被读取", async () => {
    seedConfig({ schema_version: 2, provider: "opencode-go", model: "qwen3.7-max", thinking_level: "low" });
    const { data } = await getData();
    expect(data.provider).toBe("opencode-go");
    expect(data.model).toBe("qwen3.7-max");
    expect(data.thinkingLevel).toBe("low");
  });

  it("config.provider 未知（漂移）→ 兜底 deepseek；model 不在激活目录仍显示（前端按 id 匹配）", async () => {
    seedConfig({ schema_version: 2, provider: "not-a-provider", model: "qwen3.7-max" });
    const { data } = await getData();
    expect(data.provider).toBe("deepseek");
    expect(data.model).toBe("qwen3.7-max"); // 漂移模型原样显示，llm 层兜底防御
  });

  it("损坏文件 / 非法 schema → 全默认（不抛错）", async () => {
    seedConfig({ broken: true });
    const file = userConfigPath();
    writeFileSync(file, "{not-json", "utf8");
    const { data } = await getData();
    expect(data.provider).toBe("deepseek");
    expect(data.model).toBe("deepseek-v4-flash");
    expect(((data.providers as ProviderEntry[])[0]).apiKeySet).toBe(false);
  });
});

describe("PUT /api/v1/settings/llm", () => {
  it("跨 provider 激活：provider+model 成对写入 → GET 读回；落盘 schema_version=2", async () => {
    const put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ provider: "opencode-go", model: "qwen3.7-max" }) },
    );
    expect(put.status).toBe(200);
    const { data } = await getData();
    expect(data.provider).toBe("opencode-go");
    expect(data.model).toBe("qwen3.7-max");
    const onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as { schema_version: number; provider: string; model: string };
    expect(onDisk.schema_version).toBe(2);
    expect(onDisk.provider).toBe("opencode-go");
  });

  it("model 只给不撞名的 → 归属唯一 provider 自动采用；撞名（deepseek-v4-flash）无 provider → 400 歧义", async () => {
    let put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ model: "qwen3.7-max" }) },
    );
    expect(put.status).toBe(200);
    expect(((await getData()).data as { provider: string }).provider).toBe("opencode-go");

    put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ model: "deepseek-v4-flash" }) },
    );
    expect(put.status).toBe(400);
    const body = (await put.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("撞名");
  });

  it("model 不在目标 provider 目录 → 400；model 无任何归属 → 400", async () => {
    const res = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ provider: "opencode-go", model: "gpt-9" }) },
    );
    expect(res.status).toBe(400);
    const res2 = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ model: "gpt-9" }) },
    );
    expect(res2.status).toBe(400);
  });

  it("只给 provider：当前 model 不在新目录 → 400（须显式 model）", async () => {
    seedConfig({ schema_version: 2, provider: "deepseek", model: "qwen3.7-max" });
    const res = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ provider: "deepseek" }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("qwen3.7-max");
  });

  it("api_keys 写入/合并/清除（空串）；不影响其他字段", async () => {
    seedConfig({ schema_version: 2, provider: "deepseek", model: "deepseek-v4-flash", api_keys: { deepseek: "sk-old12345678" } });
    let put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ api_keys: { "opencode-go": "oc-newkey12345678" } }) },
    );
    expect(put.status).toBe(200);
    let onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as { api_keys: Record<string, string>; model?: string };
    expect(onDisk.api_keys).toEqual({ deepseek: "sk-old12345678", "opencode-go": "oc-newkey12345678" }); // 合并不覆盖
    expect(onDisk.model).toBe("deepseek-v4-flash");

    put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ api_keys: { "opencode-go": "" } }) },
    );
    expect(put.status).toBe(200);
    onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as { api_keys: Record<string, string> };
    expect(onDisk.api_keys).toEqual({ deepseek: "sk-old12345678" });
  });

  it("api_keys 清空后字段删除（不再残留空 map）", async () => {
    seedConfig({ schema_version: 2, api_keys: { deepseek: "sk-x12345678" } });
    const put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ api_keys: { deepseek: "" } }) },
    );
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as Record<string, unknown>;
    expect("api_keys" in onDisk).toBe(false);
  });

  it("旧 v1 文件保存后升级 v2：api_key 字段保留不迁移，schema_version 变 2", async () => {
    seedConfig({ api_key: "sk-oldkey12345678", model: "deepseek-r1" });
    const put = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ provider: "deepseek", model: "deepseek-v4-flash" }) },
    );
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(readFileSync(userConfigPath(), "utf8")) as { schema_version: number; model: string; api_key: string };
    expect(onDisk.schema_version).toBe(2);
    expect(onDisk.model).toBe("deepseek-v4-flash");
    expect(onDisk.api_key).toBe("sk-oldkey12345678"); // 未传字段保留（合并语义不变；读侧兼容覆盖 deepseek）
  });

  it("非法入参 → 400 VALIDATION_ERROR（strict：旧 api_key 顶层键拒绝；model 非字符串拒绝）", async () => {
    const res = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ api_key: "sk-xxx" }) },
    );
    expect(res.status).toBe(400);
    const res2 = await buildApp().request(
      "/api/v1/settings/llm",
      { method: "PUT", headers: { ...HOST_HEADERS, "content-type": "application/json" }, body: JSON.stringify({ model: 42 }) },
    );
    expect(res2.status).toBe(400);
    const body = (await res2.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("空 body / 非法 JSON → 400 VALIDATION_ERROR", async () => {
    const res = await buildApp().request("/api/v1/settings/llm", { method: "PUT", headers: HOST_HEADERS });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("context_budget（上下文预算配置，A1）", () => {
  it("getContextBudget：缺省回落 0.15 / 8000；配置文件该段缺失/非法同样回落", () => {
    expect(getContextBudget()).toEqual({ historyRatio: 0.15, toolResultMaxTokens: 8000 });
    seedConfig({ provider: "deepseek", context_budget: { history_ratio: 5 } }); // 越界 → 整段回落
    expect(getContextBudget()).toEqual({ historyRatio: 0.15, toolResultMaxTokens: 8000 });
  });

  it("getContextBudget：合法配置生效（且不受同文件其余字段影响）", () => {
    seedConfig({ model: "deepseek-v4-flash", context_budget: { history_ratio: 0.3, tool_result_max_tokens: 12000 } });
    expect(getContextBudget()).toEqual({ historyRatio: 0.3, toolResultMaxTokens: 12000 });
  });

  it("resolveContextBudgets：常规窗口 15% 不触发 clamp（总闸 = 窗口 × 0.5）", () => {
    const r = resolveContextBudgets(1_000_000);
    expect(r.totalGate).toBe(500_000);
    expect(r.historyBudget).toBe(150_000);
    expect(r.clamped).toBe(false);
  });

  it("resolveContextBudgets：ratio 配得过大 → clamp 到「总闸 − 余量」并标记 clamped（只降级，不打断对话）", () => {
    seedConfig({ context_budget: { history_ratio: 0.9 } });
    const r = resolveContextBudgets(100_000);
    expect(r.totalGate).toBe(50_000);
    expect(r.historyBudget).toBe(42_000); // 50_000 − 8_000（余量）
    expect(r.clamped).toBe(true);
  });

  it("resolveContextBudgets：窗口过小（总闸 ≤ 余量）→ 历史预算 0 且不为负（裁空由 agent 护栏兜底）", () => {
    const r = resolveContextBudgets(10_000);
    expect(r.totalGate).toBe(5_000);
    expect(r.historyBudget).toBe(0);
    expect(r.clamped).toBe(true);
  });
});
