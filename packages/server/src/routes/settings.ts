// 设置路由（S1.3）：GET/PUT /api/v1/settings/llm
// 契约来源：doc/api/endpoints.md 第 858-890 行、doc/design/decisions.md 决策 17
// 关键约束（决策 17）：DeepSeek key 只走环境变量 DEEPSEEK_API_KEY 或用户级配置
//   ~/.ai-editor/config.json（HOME 可覆盖——测试隔离依赖），**绝不写入项目文件**
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { maskApiKey } from "@ai-editor/shared";
import { writeJsonAtomic } from "@ai-editor/db";
import { settingsLlmGetResSchema, settingsLlmPutReqSchema } from "@ai-editor/shared/schemas";
import { ok } from "../middleware/error.js";

/** 默认模型名（endpoints.md settings 端点） */
export const DEFAULT_MODEL = "deepseek-v4-flash";

/** DeepSeek key 环境变量（决策 17：环境变量优先于用户级配置） */
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";

/** 用户级配置文件相对 HOME 的路径（决策 17：不入项目文件） */
export const USER_CONFIG_RELATIVE_PATH = join(".ai-editor", "config.json");

/** 用户级配置文件结构（~/.ai-editor/config.json） */
export interface UserConfigFile {
  model?: string;
  api_key?: string;
}

/** 用户级配置文件绝对路径（os.homedir() 读 $HOME，测试设 HOME 即可隔离） */
export function userConfigPath(): string {
  return join(homedir(), USER_CONFIG_RELATIVE_PATH);
}

/**
 * 读取用户级配置；文件不存在或 JSON 损坏 → 返回空配置（默认值语义，不抛错）
 */
export function getUserConfig(): UserConfigFile {
  try {
    const raw = readFileSync(userConfigPath(), "utf8");
    return JSON.parse(raw) as UserConfigFile;
  } catch {
    return {};
  }
}

/**
 * 写入用户级配置（合并 partial；显式 undefined 字段不覆盖已有值）；
 * api_key 为空字符串 = 清除 key 字段
 * 原子写：复用 @ai-editor/db 的 writeJsonAtomic（决策 11 精神完整版：临时文件 wx 独占 +
 *   文件 fsync + rename + 目录 fsync）。目标在 $HOME/.ai-editor/ 下，目录 fsync 在部分
 *   平台/文件系统受限时由 db 实现静默忽略（主链路已保证文件内容完整）
 */
export function saveUserConfig(partial: Partial<UserConfigFile>): UserConfigFile {
  const file = userConfigPath();
  const next: UserConfigFile = { ...getUserConfig() };
  if (partial.model !== undefined) next.model = partial.model;
  if (partial.api_key !== undefined) next.api_key = partial.api_key;
  if (next.api_key === "") {
    delete next.api_key; // 空字符串 = 清除已保存 key（endpoints.md PUT 语义）
  }
  mkdirSync(dirname(file), { recursive: true }); // writeJsonAtomic 不负责建目录
  writeJsonAtomic(file, next);
  return next;
}

/**
 * 计算有效 key 与掩码：环境变量 > config.json（决策 17 来源优先级）
 * 两者都没有 → null（apiKeySet=false，无掩码）
 */
export function effectiveApiKey(): { key: string | null; masked: string | undefined } {
  const envKey = process.env[DEEPSEEK_API_KEY_ENV] ?? "";
  const fileKey = getUserConfig().api_key ?? "";
  const key = envKey || fileKey || null; // 环境变量优先
  return key === null ? { key, masked: undefined } : { key, masked: maskApiKey(key) };
}

/** 设置路由（挂载于 /api/v1/settings） */
export const settingsRoutes = new Hono();

// GET /api/v1/settings/llm —— 读取 LLM 配置（key 不回传明文，仅掩码；决策 17）
settingsRoutes.get("/llm", (c) => {
  const { key, masked } = effectiveApiKey();
  const payload = settingsLlmGetResSchema.parse({
    model: getUserConfig().model ?? DEFAULT_MODEL,
    apiKeySet: key !== null,
    ...(masked ? { apiKeyMasked: masked } : {}),
  });
  return c.json(ok(payload));
});

// PUT /api/v1/settings/llm —— 更新 LLM 配置（写入 ~/.ai-editor/config.json，绝不入项目文件，决策 17）
settingsRoutes.put("/llm", async (c) => {
  const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
  const parsed = settingsLlmPutReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  }
  saveUserConfig({
    model: parsed.data.model,
    api_key: parsed.data.api_key,
  });
  return c.json(ok({ saved: true })); // settingsLlmPutResSchema 形状
});
