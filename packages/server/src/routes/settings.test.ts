// 设置路由测试（K5）：GET/PUT /api/v1/settings/llm —— 数据源全部来自 pi
//
// 契约 = docs/api/90-api-settings.md、docs/design/config.md（配置所有权在 pi agent dir）。
// 隔离策略：
// - 临时 HOME（getAgentDir → $HOME/.pi/agent）：auth.json / models.json / settings.json 读写不出沙箱
// - provider 环境变量在每个用例前后清理（本机可能已设 DEEPSEEK_API_KEY，会让「无凭据」用例非确定）
// - pi 运行时单例每个用例后重置（HOME 变化必须重建：authPath/modelsPath/settings 都在创建期解析）
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler } from "../middleware/error.js";
import { resetModelRuntime } from "../model-runtime.js";
import { settingsRoutes } from "./settings.js";

const HOST_HEADERS = { host: "127.0.0.1:3456" }; // 来源校验 host 白名单
const JSON_HEADERS = { ...HOST_HEADERS, "content-type": "application/json" };

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

/** 本机环境可能已设的 provider 凭据（清掉才能断言「无凭据」状态） */
const ENVS = ["DEEPSEEK_API_KEY", "OPENCODE_API_KEY"] as const;

beforeEach(() => {
  originalHome = process.env.HOME;
  for (const e of ENVS) ORIGINAL_ENVS[e] = process.env[e];
  homeDir = mkdtempSync(join(tmpdir(), "ai-editor-settings-home-"));
  process.env.HOME = homeDir;
  for (const e of ENVS) delete process.env[e];
  resetModelRuntime();
});

afterEach(() => {
  resetModelRuntime(); // 先释放（单例持有沙箱内路径），再恢复 HOME
  for (const e of ENVS) {
    const v = ORIGINAL_ENVS[e];
    if (v !== undefined) process.env[e] = v;
    else delete process.env[e];
  }
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  rmSync(homeDir, { recursive: true, force: true });
});

// ============ pi agent dir 辅助（断言落盘与预置状态） ============

function agentDirPath(): string {
  return join(homeDir, ".pi", "agent");
}

function authPath(): string {
  return join(agentDirPath(), "auth.json");
}

function settingsPath(): string {
  return join(agentDirPath(), "settings.json");
}

/** 预写 pi settings（激活模型 / 思考强度） */
function seedPiSettings(settings: Record<string, unknown>): void {
  mkdirSync(agentDirPath(), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings), "utf8");
}

/** 预写 pi 凭据库 */
function seedPiAuth(auth: unknown): void {
  mkdirSync(agentDirPath(), { recursive: true });
  writeFileSync(authPath(), JSON.stringify(auth), "utf8");
}

/** 预写已废弃的自建配置（必须被忽略：K5 起不再读取） */
function seedLegacyConfig(config: Record<string, unknown>): void {
  const file = join(homeDir, ".ai-editor", "config.json");
  mkdirSync(join(homeDir, ".ai-editor"), { recursive: true });
  writeFileSync(file, JSON.stringify(config), "utf8");
}

interface ProviderEntry {
  id: string;
  displayName: string;
  authConfigured: boolean;
  authSource?: string;
  models: Array<{ id: string; provider: string; displayName: string; contextWindow: number }>;
}

interface GetData {
  provider: string;
  model: string;
  thinkingLevel: string;
  providers: ProviderEntry[];
}

async function getData(): Promise<GetData> {
  const res = await buildApp().request("/api/v1/settings/llm", { headers: HOST_HEADERS });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { success: boolean; data: GetData };
  return body.data;
}

async function put(body: unknown): Promise<{ status: number; body: { error?: { code: string; message: string } } }> {
  const res = await buildApp().request("/api/v1/settings/llm", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { error?: { code: string; message: string } } };
}

function providerOf(data: GetData, id: string): ProviderEntry {
  const found = data.providers.find((p) => p.id === id);
  expect(found, `provider ${id} 应在 providers 列表内`).toBeDefined();
  return found!;
}

describe("GET /api/v1/settings/llm（pi 数据源）", () => {
  it("无任何凭据 → provider/model 空串 + thinkingLevel 取 pi 缺省 + 全量 provider 均未配置", async () => {
    const data = await getData();
    expect(data.provider).toBe("");
    expect(data.model).toBe("");
    expect(data.thinkingLevel).toBe("medium"); // pi 缺省（core/defaults.ts）
    expect(data.providers.length).toBeGreaterThan(2); // 全量内置 provider（非白名单）
    const deep = providerOf(data, "deepseek");
    expect(deep.displayName).toBe("DeepSeek");
    expect(deep.authConfigured).toBe(false);
    expect(deep.authSource).toBeUndefined();
    expect(deep.models.map((m) => m.id)).toContain("deepseek-v4-flash");
    expect(deep.models.every((m) => m.provider === "deepseek")).toBe(true);
  });

  it("provider 目录来自 pi：模型条目带 contextWindow/displayName（前端下拉与占用分母）", async () => {
    const data = await getData();
    const flash = providerOf(data, "deepseek").models.find((m) => m.id === "deepseek-v4-flash");
    expect(flash).toBeDefined();
    expect(flash!.displayName).toBe("DeepSeek V4 Flash");
    expect(typeof flash!.contextWindow).toBe("number");
    expect(flash!.contextWindow).toBeGreaterThan(0);
  });

  it("环境变量凭据 → authConfigured=true + authSource=environment（并据此解析激活模型）", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-env-key-123456";
    resetModelRuntime(); // 单例已按旧环境快照；重建以反映新 env（生产态 env 在进程启动即固定）
    const data = await getData();
    const deep = providerOf(data, "deepseek");
    expect(deep.authConfigured).toBe(true);
    expect(deep.authSource).toBe("environment");
    // 无 pi settings defaultModel → 首个有凭据的可用模型
    expect(data.provider).toBe("deepseek");
    expect(data.model).toBe("deepseek-v4-flash");
    expect(providerOf(data, "opencode-go").authConfigured).toBe(false);
  });

  it("pi auth.json 凭据 → authConfigured=true + authSource=stored", async () => {
    seedPiAuth({ deepseek: { type: "api_key", key: "sk-stored-123456" } });
    const data = await getData();
    const deep = providerOf(data, "deepseek");
    expect(deep.authConfigured).toBe(true);
    expect(deep.authSource).toBe("stored");
  });

  it("pi settings 的 defaultProvider+defaultModel 被读回（激活模型来自 pi，不来自自建配置）", async () => {
    seedPiSettings({ defaultProvider: "opencode-go", defaultModel: "qwen3.7-max" });
    seedPiAuth({ "opencode-go": { type: "api_key", key: "oc-stored-123456" } });
    const data = await getData();
    expect(data.provider).toBe("opencode-go");
    expect(data.model).toBe("qwen3.7-max");
  });

  it("pi settings 的 defaultThinkingLevel 被读回", async () => {
    seedPiSettings({ defaultThinkingLevel: "low" });
    expect((await getData()).thinkingLevel).toBe("low");
  });

  it("已废弃的 ~/.ai-editor/config.json 被忽略（api_keys / provider / model 均不生效）", async () => {
    seedLegacyConfig({
      schema_version: 2,
      provider: "opencode-go",
      model: "qwen3.7-max",
      thinking_level: "low",
      api_keys: { deepseek: "sk-legacy-123456" },
    });
    const data = await getData();
    expect(data.provider).toBe("");
    expect(data.model).toBe("");
    expect(data.thinkingLevel).toBe("medium");
    expect(providerOf(data, "deepseek").authConfigured).toBe(false);
  });
});

describe("PUT /api/v1/settings/llm（写 pi settings）", () => {
  it("provider+model 成对写入 → GET 读回 + 落盘 ~/.pi/agent/settings.json", async () => {
    seedPiAuth({ "opencode-go": { type: "api_key", key: "oc-stored-123456" } });
    const res = await put({ provider: "opencode-go", model: "qwen3.7-max" });
    expect(res.status).toBe(200);

    const data = await getData();
    expect(data.provider).toBe("opencode-go");
    expect(data.model).toBe("qwen3.7-max");

    const onDisk = JSON.parse(readFileSync(settingsPath(), "utf8")) as {
      defaultProvider: string;
      defaultModel: string;
    };
    expect(onDisk.defaultProvider).toBe("opencode-go");
    expect(onDisk.defaultModel).toBe("qwen3.7-max");
    // 自建配置文件绝不产生（配置所有权在 pi）
    expect(existsSync(join(homeDir, ".ai-editor", "config.json"))).toBe(false);
  });

  it("只给 model：唯一归属自动定 provider；撞名 / 无归属 → 400", async () => {
    // pi 全量目录下模型可归属多家：只在唯一一家出现的模型才能免 provider
    expect((await put({ model: "amazon.nova-2-lite-v1:0" })).status).toBe(200);
    expect((await getData()).provider).toBe("amazon-bedrock");

    const ambiguous = await put({ model: "qwen3.7-max" }); // opencode-go / qwen-token-plan(-cn/-individual)
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.error?.message).toContain("撞名");

    const missing = await put({ model: "gpt-9" });
    expect(missing.status).toBe(400);
    expect(missing.body.error?.message).toContain("不在任何 provider 目录");
  });

  it("model 不在目标 provider 目录 → 400；未知 provider → 400", async () => {
    const mismatch = await put({ provider: "opencode-go", model: "gpt-9" });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error?.message).toContain("不在 provider");

    const unknown = await put({ provider: "not-a-provider", model: "x" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error?.message).toContain("未知 provider");
  });

  it("只给 provider：当前模型不在其目录 → 400（须显式 model）；当前无激活模型同样 400", async () => {
    // 激活模型属 opencode-go；切到 deepseek 而不指定 model → 当前模型不在目标目录 → 400
    seedPiSettings({ defaultProvider: "opencode-go", defaultModel: "qwen3.7-max" });
    seedPiAuth({ "opencode-go": { type: "api_key", key: "oc-stored-123456" } });
    const res = await put({ provider: "deepseek" });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("qwen3.7-max");

    // 无任何凭据 / 无激活模型 → 切 provider 无从消歧
    resetModelRuntime();
    rmSync(agentDirPath(), { recursive: true, force: true });
    const none = await put({ provider: "deepseek" });
    expect(none.status).toBe(400);
    expect(none.body.error?.message).toContain("当前无激活模型");
  });

  it("thinking_level 写 pi settings 并读回", async () => {
    expect((await put({ thinking_level: "high" })).status).toBe(200);
    expect((await getData()).thinkingLevel).toBe("high");
    expect(JSON.parse(readFileSync(settingsPath(), "utf8"))).toMatchObject({ defaultThinkingLevel: "high" });
  });
});

describe("PUT /api/v1/settings/llm（api_key → pi credential store）", () => {
  it("非空 key 写入 pi 凭据库（auth.json）→ authConfigured=true + authSource=stored", async () => {
    const res = await put({ api_key: { provider: "deepseek", key: "sk-typed-123456" } });
    expect(res.status).toBe(200);

    const data = await getData();
    const deep = providerOf(data, "deepseek");
    expect(deep.authConfigured).toBe(true);
    expect(deep.authSource).toBe("stored");

    // 落盘位置 = pi agent dir（沙箱内），凭据只存 key 本身
    const stored = JSON.parse(readFileSync(authPath(), "utf8")) as Record<string, { type: string; key?: string }>;
    expect(stored.deepseek?.type).toBe("api_key");
    expect(stored.deepseek?.key).toBe("sk-typed-123456");
  });

  it("保存 key 不改动激活模型（两个入口互不影响）", async () => {
    seedPiAuth({ "opencode-go": { type: "api_key", key: "oc-stored-123456" } });
    await put({ provider: "opencode-go", model: "qwen3.7-max" });
    await put({ api_key: { provider: "deepseek", key: "sk-typed-123456" } });
    const data = await getData();
    expect(data.provider).toBe("opencode-go");
    expect(data.model).toBe("qwen3.7-max");
    expect(providerOf(data, "deepseek").authConfigured).toBe(true);
  });

  it("空串 key = 清除该家存量凭据（回到 env 解析）", async () => {
    seedPiAuth({ deepseek: { type: "api_key", key: "sk-stored-123456" } });
    expect(providerOf(await getData(), "deepseek").authConfigured).toBe(true);

    expect((await put({ api_key: { provider: "deepseek", key: "" } })).status).toBe(200);
    const data = await getData();
    expect(providerOf(data, "deepseek").authConfigured).toBe(false);
    const stored = JSON.parse(readFileSync(authPath(), "utf8")) as Record<string, unknown>;
    expect(stored.deepseek).toBeUndefined();
  });

  it("存量 OAuth 凭据 → 空串清除被拒（不误删订阅登录）", async () => {
    seedPiAuth({
      deepseek: { type: "oauth", refresh: "r", access: "a", expires: Date.now() + 3_600_000 },
    });
    const res = await put({ api_key: { provider: "deepseek", key: "" } });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("OAuth");
    const stored = JSON.parse(readFileSync(authPath(), "utf8")) as Record<string, unknown>;
    expect(stored.deepseek).toBeDefined(); // 凭据未被删除
  });

  it("存量 OAuth 凭据 → 非空 API key 写入也被拒（不静默覆盖订阅登录）", async () => {
    seedPiAuth({
      deepseek: { type: "oauth", refresh: "r", access: "a", expires: Date.now() + 3_600_000 },
    });
    const res = await put({ api_key: { provider: "deepseek", key: "sk-new" } });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("OAuth");
    const stored = JSON.parse(readFileSync(authPath(), "utf8")) as Record<string, unknown>;
    expect((stored.deepseek as { type?: string }).type).toBe("oauth"); // 原凭据未被覆盖
  });

  it("未知 provider 的 key 写入 → 400", async () => {
    const res = await put({ api_key: { provider: "not-a-provider", key: "sk-x" } });
    expect(res.status).toBe(400);
    expect(res.body.error?.message).toContain("未知 provider");
  });

  it("无交互式 api_key login 的 provider → 400（不静默成功）", async () => {
    // openai-codex 只支持订阅登录（pi 目录中唯一没有 auth.apiKey.login 的 provider）
    const res = await put({ api_key: { provider: "openai-codex", key: "sk-x" } });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    expect(res.body.error?.message).toContain("openai-codex");
  });
});

describe("PUT /api/v1/settings/llm（入参校验）", () => {
  it("空 body / 非法 JSON → 400 VALIDATION_ERROR", async () => {
    const empty = await buildApp().request("/api/v1/settings/llm", { method: "PUT", headers: HOST_HEADERS });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");

    const broken = await put("{not-json");
    expect(broken.status).toBe(400);
    expect(broken.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("strict：旧 api_keys 映射 / 裸 api_key 字符串 / 非法 thinking_level → 400", async () => {
    expect((await put({ api_keys: { deepseek: "sk-x" } })).status).toBe(400);
    expect((await put({ api_key: "sk-x" })).status).toBe(400);
    expect((await put({ api_key: { provider: "deepseek" } })).status).toBe(400);
    expect((await put({ thinking_level: "bogus" })).status).toBe(400);
    expect((await put({ model: 42 })).status).toBe(400);
  });
});
