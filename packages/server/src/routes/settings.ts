// 设置路由（S1.3 + 多 provider）：GET/PUT /api/v1/settings/llm
// 关键约束：各 provider key 只走三级解析链（不入项目文件）：
//   ① 环境变量（deepseek → DEEPSEEK_API_KEY；opencode-go → OPENCODE_API_KEY）
//   ② 用户级配置 ~/.ai-editor/config.json api_keys[<provider>]（HOME 可覆盖——测试隔离依赖；
//      v1 旧 api_key 字段仅对 deepseek 生效）
//   ③ pi-agent 配置 ~/.pi/agent/auth.json（**只读兜底**：条目 type=api_key 且 key 非空才生效，
//      文件不存在/非法/无该项 → 跳过；绝不写回）
// 模型解析不变式：model 属于激活 provider 目录；撞名模型（deepseek-v4-flash/pro 两家都有）
// 以 provider 消歧；跨 provider 激活由 PUT 携带 provider+model 成对完成（见 PUT 校验）。
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { maskApiKey } from "@whispering233/ai-editor-shared";
import type { UserConfigFile } from "@whispering233/ai-editor-shared";
import { writeJsonAtomic } from "@whispering233/ai-editor-db";
import {
  settingsLlmGetResSchema,
  settingsLlmPutReqSchema,
  userConfigFileSchema,
  type ThinkingLevel,
} from "@whispering233/ai-editor-shared/schemas";
import { DEFAULT_PROVIDER, getAvailableModels, REGISTERED_PROVIDERS } from "@whispering233/ai-editor-llm";
import { TOOL_RESULT_MAX_TOKENS } from "@whispering233/ai-editor-agent";
import { HttpError, ok } from "../middleware/error.js";

/** 默认模型名（settings 端点；两 provider 目录均含该模型——兜底/初始态稳定） */
export const DEFAULT_MODEL = "deepseek-v4-flash";

/** 环境变量（各 provider 解析链第 ① 级；测试经 process.env 注入） */
export const DEEPSEEK_API_KEY_ENV = "DEEPSEEK_API_KEY";
export const OPENCODE_API_KEY_ENV = "OPENCODE_API_KEY";

/** provider id → 环境变量名（注册表内 provider 必含；未知 provider 无 env 级） */
const ENV_VAR_OF: Readonly<Record<string, string>> = {
  deepseek: DEEPSEEK_API_KEY_ENV,
  "opencode-go": OPENCODE_API_KEY_ENV,
};

/** 用户级配置文件相对 HOME 的路径（不入项目文件） */
export const USER_CONFIG_RELATIVE_PATH = join(".ai-editor", "config.json");

/** pi-agent 凭据文件相对 HOME 的路径（只读兜底；opencode-go 订阅 key 通常在此） */
export const PI_AGENT_AUTH_RELATIVE_PATH = join(".pi", "agent", "auth.json");

/** 缺省思考强度（与 SharedConfig 缺省一致，读侧兜底） */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";

/** 缺省历史预算比例（历史层 = 激活模型 contextWindow × 该值；config.json 缺失/非法时回落） */
export const DEFAULT_HISTORY_RATIO = 0.15;

/** 缺省单条工具结果 token 上限（单一事实源 = agent 运行时常量；此处仅再导出供本包消费） */
export const DEFAULT_TOOL_RESULT_MAX_TOKENS = TOOL_RESULT_MAX_TOKENS;

/** 上下文总闸占窗口的比例（不可配——失控保护安全网，见 docs/design/config.md「可配 / 不可配边界」） */
export const CONTEXT_GATE_RATIO = 0.5;

/** 总闸与历史预算之间的余量（历史预算 clamp 到「总闸 − 该余量」，防历史预算把总闸撞成 terminate） */
export const CONTEXT_GATE_RESERVE_TOKENS = 8000;

/** 用户级配置文件绝对路径（os.homedir() 读 $HOME，测试设 HOME 即可隔离） */
export function userConfigPath(): string {
  return join(homedir(), USER_CONFIG_RELATIVE_PATH);
}

/** pi-agent auth.json 绝对路径（只读；测试设 HOME 即可隔离） */
export function piAgentAuthPath(): string {
  return join(homedir(), PI_AGENT_AUTH_RELATIVE_PATH);
}

/**
 * 读取用户级配置；文件不存在 / JSON 损坏 / schema 不合法 → 返回空配置（默认值语义，不抛错）。
 * schema 正式化（shared userConfigFileSchema，非 strict 宽松读取——用户自有文件，
 * 未来版本追加字段不使整份配置失效）；v0/v1 旧格式与 v2 同读侧兼容，不迁移不写回
 * （用户下次在设置页保存时自然落新格式）。
 */
export function getUserConfig(): UserConfigFile {
  try {
    const raw = readFileSync(userConfigPath(), "utf8");
    const parsed = userConfigFileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * 上下文预算配置（用户级 config.json `context_budget` 段）。
 * 字段缺失/越界/整段非法 → 回落缺省（宽容读取：配置错不应使聊天不可用）。
 */
export function getContextBudget(): { historyRatio: number; toolResultMaxTokens: number } {
  const cfg = getUserConfig().context_budget;
  return {
    historyRatio: cfg?.history_ratio ?? DEFAULT_HISTORY_RATIO,
    toolResultMaxTokens: cfg?.tool_result_max_tokens ?? DEFAULT_TOOL_RESULT_MAX_TOKENS,
  };
}

/**
 * 由激活模型的 contextWindow 解析本轮生效预算：
 * - 总闸 = `window × CONTEXT_GATE_RATIO`（不可配；agent 超限即 error 终止，见 run.ts tokenBudget）
 * - 历史预算 = `min(window × historyRatio, 总闸 − 余量)`：用户把 ratio 配得过大时**只降级不打断对话**
 * - 窗口过小（总闸 ≤ 余量）时历史预算为 0——由 agent 侧「裁剪不得裁空」护栏兜底（A2）
 * 纯函数（不记日志）；clamped=true 时由调用方记日志。
 */
export function resolveContextBudgets(contextWindow: number): {
  historyBudget: number;
  totalGate: number;
  clamped: boolean;
} {
  const { historyRatio } = getContextBudget();
  const totalGate = Math.floor(contextWindow * CONTEXT_GATE_RATIO);
  const desired = Math.floor(contextWindow * historyRatio);
  const limit = Math.max(0, totalGate - CONTEXT_GATE_RESERVE_TOKENS);
  const historyBudget = Math.min(desired, limit);
  return { historyBudget, totalGate, clamped: historyBudget < desired };
}

/** 激活 provider：config.provider 已注册才采用；否则缺省 deepseek（配置漂移兜底） */
export function effectiveProvider(): string {
  const p = getUserConfig().provider;
  return p !== undefined && REGISTERED_PROVIDERS.some((x) => x.id === p) ? p : DEFAULT_PROVIDER;
}

/** config 级 key：api_keys[provider]（含空串 = 显式清除）> v1 旧 api_key（仅 deepseek 读侧兼容） */
function configKeyOf(cfg: UserConfigFile, provider: string): string | null {
  if (cfg.api_keys !== undefined && Object.prototype.hasOwnProperty.call(cfg.api_keys, provider)) {
    return cfg.api_keys[provider] || null; // 空串 = 显式清除（不回落旧字段）
  }
  if (provider === "deepseek" && typeof cfg.api_key === "string" && cfg.api_key !== "") return cfg.api_key;
  return null;
}

/** pi-agent auth.json 只读兜底：条目 type=api_key 且 key 非空才生效；任何异常 → null */
function piAgentKeyOf(provider: string): string | null {
  try {
    const obj: unknown = JSON.parse(readFileSync(piAgentAuthPath(), "utf8"));
    const entry = (obj as Record<string, unknown> | null)?.[provider];
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (e.type === "api_key" && typeof e.key === "string" && e.key !== "") return e.key;
    return null;
  } catch {
    return null;
  }
}

/** provider 展示名（错误文案/调试用）；未知 provider → 原 id */
export function providerDisplayName(provider: string): string {
  return REGISTERED_PROVIDERS.find((p) => p.id === provider)?.displayName ?? provider;
}

/** provider 环境变量名（错误文案用） */
export function providerEnvVar(provider: string): string | undefined {
  return ENV_VAR_OF[provider];
}

/**
 * 计算某 provider 的有效 key 与掩码：环境变量 > config.json > pi-agent auth.json（只读兜底）
 * 三级都无 → null（apiKeySet=false，无掩码）。缺省 provider = deepseek（旧单 provider 语义）。
 */
export function effectiveApiKey(provider: string = DEFAULT_PROVIDER): { key: string | null; masked: string | undefined } {
  const envKey = process.env[ENV_VAR_OF[provider] ?? ""] ?? "";
  const fileKey = configKeyOf(getUserConfig(), provider) ?? "";
  const ambientKey = piAgentKeyOf(provider) ?? "";
  const key = envKey || fileKey || ambientKey || null;
  return key === null ? { key, masked: undefined } : { key, masked: maskApiKey(key) };
}

/**
 * 写入用户级配置（v2 合并语义：显式 undefined 字段不覆盖已有值）。
 * - provider/model/thinking_level 顶层覆盖
 * - api_keys 按键合并：提供即覆盖，空字符串 = 删除该键（清空 map 时整个字段移除）
 * - 落盘 schema_version=2；v1 旧 api_key 字段保留不迁移（读侧兼容已覆盖）
 * 原子写：复用 @whispering233/ai-editor-db 的 writeJsonAtomic（临时文件 wx 独占 +
 * 文件 fsync + rename + 目录 fsync）。目标在 $HOME/.ai-editor/ 下，目录 fsync 在部分
 * 平台/文件系统受限时由 db 实现静默忽略（主链路已保证文件内容完整）
 */
export function saveUserConfig(partial: {
  provider?: string;
  model?: string;
  thinking_level?: ThinkingLevel;
  api_keys?: Record<string, string>;
}): UserConfigFile {
  const file = userConfigPath();
  const next: UserConfigFile = { ...getUserConfig() };
  if (partial.provider !== undefined) next.provider = partial.provider;
  if (partial.model !== undefined) next.model = partial.model;
  if (partial.thinking_level !== undefined) next.thinking_level = partial.thinking_level;
  if (partial.api_keys !== undefined) {
    const map: Record<string, string> = { ...(next.api_keys ?? {}) };
    for (const [k, v] of Object.entries(partial.api_keys)) {
      if (v === "") delete map[k]; // 空字符串 = 清除该家已保存 key
      else map[k] = v;
    }
    if (Object.keys(map).length > 0) next.api_keys = map;
    else delete next.api_keys;
  }
 // 保存时落新格式：schema_version=2（读侧兼容已保证 v0/v1 文件零破坏）
  next.schema_version = 2;
  mkdirSync(dirname(file), { recursive: true }); // writeJsonAtomic 不负责建目录
  writeJsonAtomic(file, next);
  return next;
}

/** 设置路由（挂载于 /api/v1/settings） */
export const settingsRoutes = new Hono();

// GET /api/v1/settings/llm —— 读取 LLM 配置（key 不回传明文，仅掩码；全量 provider 目录 + 各家 key 状态）
settingsRoutes.get("/llm", (c) => {
  const cfg = getUserConfig();
  const provider = effectiveProvider();
  const payload = settingsLlmGetResSchema.parse({
    provider,
    model: cfg.model ?? DEFAULT_MODEL,
    thinkingLevel: cfg.thinking_level ?? DEFAULT_THINKING_LEVEL,
 // 全量注册 provider：各家目录 + 有效 key 状态（前端下拉分组 + key 缺失整组禁用的依据）
    providers: REGISTERED_PROVIDERS.map((p) => {
      const { key, masked } = effectiveApiKey(p.id);
      return {
        id: p.id,
        displayName: p.displayName,
        apiKeySet: key !== null,
        ...(masked !== undefined ? { apiKeyMasked: masked } : {}),
        models: getAvailableModels(p.id).map((m) => ({
          id: m.id,
          provider: m.provider,
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning,
        })),
      };
    }),
  });
  return c.json(ok(payload));
});

// PUT /api/v1/settings/llm —— 更新 LLM 配置（写入 ~/.ai-editor/config.json，绝不入项目文件）
// 校验不变式：最终 (provider, model) 必须满足 model ∈ provider 目录
// - provider+model 成对（跨 provider 激活，前端恒成对发送）；model 不在该目录 → 400
// - 只给 model：唯一归属自动定 provider；撞名（deepseek-v4-flash/pro 两目录都有）歧义 → 400（须显式 provider）
// - 只给 provider：当前 model 不在新目录 → 400（须显式 model；防静默改用户选择）
settingsRoutes.put("/llm", async (c) => {
  const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
  const parsed = settingsLlmPutReqSchema.safeParse(raw);
  if (!parsed.success) {
    throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  }
  const { provider, model, thinking_level, api_keys } = parsed.data;

  const cfg = getUserConfig();
  let targetProvider = provider ?? effectiveProvider();
  const currentModel = cfg.model ?? DEFAULT_MODEL;

  if (model !== undefined) {
    if (provider === undefined) {
 // 只给 model：归属唯一 provider（撞名歧义 → 400，须显式 provider）
      const owners = REGISTERED_PROVIDERS.filter((p) => getAvailableModels(p.id).some((m) => m.id === model));
      if (owners.length === 1) targetProvider = owners[0].id;
      else if (owners.length === 0) throw new HttpError(400, "VALIDATION_ERROR", `模型不在任何已注册 provider 目录: ${model}`);
      else throw new HttpError(400, "VALIDATION_ERROR", `模型在多 provider 目录中存在（撞名），请显式指定 provider: ${owners.map((p) => p.id).join("/")}`);
    }
    if (!getAvailableModels(targetProvider).some((m) => m.id === model)) {
      throw new HttpError(400, "VALIDATION_ERROR", `模型 ${model} 不在 provider ${providerDisplayName(targetProvider)} 目录`);
    }
  } else if (provider !== undefined && !getAvailableModels(provider).some((m) => m.id === currentModel)) {
 // 只给 provider：当前 model 必须仍在新目录（默认模型两目录都有，正常路径恒过）
    throw new HttpError(400, "VALIDATION_ERROR", `当前模型 ${currentModel} 不在 provider ${providerDisplayName(provider)} 目录，请显式选择模型`);
  }

  saveUserConfig({
    provider: model !== undefined || provider !== undefined ? targetProvider : undefined,
    model,
    thinking_level,
    api_keys,
  });
  return c.json(ok({ saved: true })); // settingsLlmPutResSchema 形状
});
