// 设置路由：GET/PUT /api/v1/settings/llm（pi 数据源）
//
// 契约 = docs/api/90-api-settings.md；配置载体与读写边界 = docs/design/config.md。
//
// **本模块不持有任何配置**：模型目录 / 凭据 / 运行参数全部来自 pi（`ModelRuntime` +
// `~/.pi/agent` 的 auth.json / models.json / settings.json），本端点只做「读快照 + 写 pi」。
// 凭据解析顺序（pi 0.85.1，`pi-ai` auth/resolve.js）——**auth.json 存量凭据优先**（一家一条，值可
// 为字面 key / `$ENV_VAR` 引用 / `!命令`）→ 该家无条目时才回落到 provider 内置环境变量
// （`DEEPSEEK_API_KEY` 等）——环境变量是兜底，不是与凭据并存的第二个来源。
//
// 写入语义（两个入口互不影响）：
// - provider/model/thinking_level → pi settings（`~/.pi/agent/settings.json`）
// - api_key（单家）→ pi credential store（`~/.pi/agent/auth.json`）；空串 = 清除该家存量的 API key 凭据
//
// 绝不写入项目文件（项目目录内的 `.pi/` 同样不参与：settings 实例 projectTrusted=false）。

import { Hono } from "hono";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import { CredentialSynchronizationError, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { settingsLlmGetResSchema, settingsLlmPutReqSchema } from "@whispering233/ai-editor-shared/schemas";
import { HttpError, ok } from "../middleware/error.js";
import {
  PI_DEFAULT_THINKING_LEVEL,
  getModelRuntime,
  getSettingsManager,
  reloadModelRuntime,
  resolveActiveSelection,
} from "../model-runtime.js";

/** 设置路由（挂载于 /api/v1/settings） */
export const settingsRoutes = new Hono();

/** 错误信息文本（不泄露凭据内容：pi 的错误只含 provider id/原因） */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// GET /api/v1/settings/llm —— provider 目录 + 认证状态 + 激活模型（凭据明文永不回传）
settingsRoutes.get("/llm", async (c) => {
  const modelRuntime = await getModelRuntime();
  const settings = getSettingsManager();
  // 本地重载（不联网）：外部编辑 models.json / 环境变量变化在下次读取即可见
  await reloadModelRuntime(modelRuntime);

  const selection = await resolveActiveSelection(modelRuntime, settings);

  const payload = settingsLlmGetResSchema.parse({
    // 未配置任何模型 → 空串（前端展示「未配置」引导）
    provider: selection?.provider ?? "",
    model: selection?.modelId ?? "",
    thinkingLevel: settings.getDefaultThinkingLevel() ?? PI_DEFAULT_THINKING_LEVEL,
    // 全量 provider（含未配置认证者）：设置页需要展示并引导录入 key
    providers: modelRuntime.getProviders().map((provider) => {
      const status = modelRuntime.getProviderAuthStatus(provider.id);
      return {
        id: provider.id,
        displayName: provider.name,
        authConfigured: status.configured,
        ...(status.source === undefined ? {} : { authSource: status.source }),
        models: modelRuntime.getModels(provider.id).map((model) => ({
          id: model.id,
          provider: model.provider,
          displayName: model.name,
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
          reasoning: model.reasoning,
        })),
      };
    }),
  });
  return c.json(ok(payload));
});

/**
 * 解析 PUT 的目标 (provider, model) 对（不变式：model 必须属于目标 provider 目录）。
 * - provider+model 同传：跨 provider 激活（前端恒成对发送）
 * - 只给 model：唯一归属自动定 provider；无归属 / 撞名歧义 → 400
 * - 只给 provider：当前模型必须仍在其目录（防静默改用户选择）
 */
function resolveTargetModel(
  modelRuntime: ModelRuntime,
  input: { provider?: string; model?: string; currentModelId?: string },
): { provider: string; modelId: string } | null {
  const { provider, model, currentModelId } = input;
  if (provider !== undefined && modelRuntime.getProvider(provider) === undefined) {
    throw new HttpError(400, "VALIDATION_ERROR", `未知 provider: ${provider}`);
  }
  const modelIdsOf = (providerId: string): Set<string> =>
    new Set(modelRuntime.getModels(providerId).map((m) => m.id));

  if (model !== undefined) {
    let targetProvider = provider;
    if (targetProvider === undefined) {
      const owners = modelRuntime.getProviders().filter((p) => modelIdsOf(p.id).has(model));
      if (owners.length === 0) {
        throw new HttpError(400, "VALIDATION_ERROR", `模型不在任何 provider 目录: ${model}`);
      }
      if (owners.length > 1) {
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          `模型在多 provider 目录中存在（撞名），请显式指定 provider: ${owners.map((p) => p.id).join("/")}`,
        );
      }
      targetProvider = owners[0]!.id;
    }
    if (!modelIdsOf(targetProvider).has(model)) {
      const displayName = modelRuntime.getProvider(targetProvider)?.name ?? targetProvider;
      throw new HttpError(400, "VALIDATION_ERROR", `模型 ${model} 不在 provider ${displayName} 目录`);
    }
    return { provider: targetProvider, modelId: model };
  }

  if (provider !== undefined) {
    const current = currentModelId;
    if (current === undefined || current === "") {
      throw new HttpError(400, "VALIDATION_ERROR", `切换 provider 需显式指定 model（当前无激活模型）`);
    }
    if (!modelIdsOf(provider).has(current)) {
      const displayName = modelRuntime.getProvider(provider)?.name ?? provider;
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `当前模型 ${current} 不在 provider ${displayName} 目录，请显式选择模型`,
      );
    }
    return { provider, modelId: current };
  }

  return null;
}

/**
 * 写入 / 清除单家 API key 凭据（pi credential store）。
 * - 非空 key：走 pi 的 `login("api_key")`——交互式提示由我们不变量地回填本次输入
 *   （pi 会把凭据落盘到 auth.json 并做**本地**凭据同步，不联网）
 * - 空 key：删除该家存量的 api_key 凭据（回到 env 解析）；OAuth 凭据不在此入口删除
 *   （设置页只写 API key，误删会让用户的订阅登录失效）
 */
async function applyApiKey(modelRuntime: ModelRuntime, providerId: string, key: string): Promise<void> {
  if (modelRuntime.getProvider(providerId) === undefined) {
    throw new HttpError(400, "VALIDATION_ERROR", `未知 provider: ${providerId}`);
  }
  const trimmed = key.trim();

  if (trimmed === "") {
    const stored = (await modelRuntime.listCredentials()).find((entry) => entry.providerId === providerId);
    if (stored?.type === "oauth") {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        `${providerId} 当前使用 OAuth 凭据登录，本入口只能清除 API key（请用 pi CLI 管理订阅登录）`,
      );
    }
    await modelRuntime.logout(providerId);
    return;
  }

  // 与清除路径对称：存量 OAuth（订阅登录）不得被一次 API key 写入静默覆盖
  // （pi 每 provider 只存一条凭据；覆盖后用户需用 pi CLI 重新登录才能恢复）
  const existing = (await modelRuntime.listCredentials()).find((entry) => entry.providerId === providerId);
  if (existing?.type === "oauth") {
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      `${providerId} 当前使用 OAuth 凭据登录，本入口不覆盖订阅登录（请用 pi CLI 管理订阅登录）`,
    );
  }

  const interaction: AuthInteraction = {
    notify: () => {
      // pi 的登录进度提示（终端向）；本入口无 UI，忽略
    },
    prompt: async (prompt) => {
      if (prompt.type === "secret") return trimmed;
      if (prompt.type === "select") {
        const option = prompt.options.find((o) => o.id === "api-key" || o.id === "bearer-token");
        if (option !== undefined) return option.id;
      }
      throw new Error(`${providerId} 需要交互式认证配置，本入口只支持 API key`);
    },
  };

  try {
    await modelRuntime.login(providerId, "api_key", interaction);
  } catch (err) {
    // 凭据已落盘、仅本地状态同步失败：按服务端错误呈现（让用户重试而不是怀疑输入）
    if (err instanceof CredentialSynchronizationError) {
      throw new HttpError(
        500,
        "INTERNAL_ERROR",
        `${providerId} 的凭据已写入，但模型状态同步失败：${messageOf(err)}`,
      );
    }
    throw new HttpError(400, "VALIDATION_ERROR", `保存 ${providerId} 的 API key 失败：${messageOf(err)}`);
  }
}

// PUT /api/v1/settings/llm —— 写 pi settings（模型/思考强度）+ pi credential store（key）
settingsRoutes.put("/llm", async (c) => {
  const raw = await c.req.json().catch(() => null); // 空 body / 非法 JSON → 校验失败
  const parsed = settingsLlmPutReqSchema.safeParse(raw);
  if (!parsed.success) throw parsed.error; // → app.onError → 400 VALIDATION_ERROR（含 fields）
  const { provider, model, thinking_level, api_key } = parsed.data;

  const modelRuntime = await getModelRuntime();
  const settings = getSettingsManager();
  // 本地重载（不联网）：PUT 与 GET 看到同一份目录（外部编辑 models.json 后直接 PUT 模型也能校验通过）
  await reloadModelRuntime(modelRuntime);

  // ---- 凭据（独立于模型切换：只保存 key 不改激活模型） ----
  if (api_key !== undefined) {
    await applyApiKey(modelRuntime, api_key.provider, api_key.key);
  }

  // ---- 激活模型（provider + model 成对；缺省按当前激活模型消歧） ----
  if (provider !== undefined || model !== undefined) {
    const selection = await resolveActiveSelection(modelRuntime, settings);
    const target = resolveTargetModel(modelRuntime, {
      provider,
      model,
      currentModelId: selection?.modelId,
    });
    if (target !== null) settings.setDefaultModelAndProvider(target.provider, target.modelId);
  }

  if (thinking_level !== undefined) settings.setDefaultThinkingLevel(thinking_level);

  return c.json(ok({ saved: true })); // settingsLlmPutResSchema 形状
});
