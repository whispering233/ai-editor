// server：pi 运行时的进程级单例（模型目录 + 凭据 + 全局 settings）
//
// 为什么单例：模型目录（内置目录 + `~/.pi/agent/models.json` 覆盖 + 远端 overlay 缓存）、
// 凭据（`~/.pi/agent/auth.json`）、运行参数（`~/.pi/agent/settings.json`）都只有一份真相源，
// 每请求/每项目各建一份会重复建目录、重复刷可用性，且设置端点与对话端点会读到不同快照。
//
// 配置所有权在 pi（docs/design/config.md）：本模块只做「懒创建 + 复用 + 测试重置」，
// 不缓存、不镜像任何自建配置；项目目录内的 `.pi/` 一律不参与（`projectTrusted: false`）。

import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { resolveAgentDir, type ProjectRuntime } from "@whispering233/ai-editor-agent";

/**
 * 思考强度类型：直接从 pi 的 setter 签名取（pi-coding-agent 包根不导出该类型），
 * 避免跨包手工声明一份可能漂移的联合类型。
 */
export type ThinkingLevel = Parameters<SettingsManager["setDefaultThinkingLevel"]>[0];

/** pi 未配置 defaultThinkingLevel 时的行为与 pi 自身缺省一致（coding-agent core/defaults.ts） */
export const PI_DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";

let runtimePromise: Promise<ModelRuntime> | undefined;
let settingsManager: SettingsManager | undefined;

/**
 * pi 模型/凭据运行时（懒创建；缺省读 `~/.pi/agent` 的 auth.json / models.json）。
 * 创建期不联网（`allowNetwork` 未开启）——远端目录刷新由 pi 的本地缓存语义承担。
 */
export function getModelRuntime(): Promise<ModelRuntime> {
  runtimePromise ??= ModelRuntime.create();
  return runtimePromise;
}

/**
 * 全局 settings（激活模型 / 思考强度 / 重试 / 压缩参数）。
 * `projectTrusted: false`：项目目录可能来自他人，其中的 `.pi/settings.json` 不参与配置；
 * 因此本实例只读写 `~/.pi/agent/settings.json`。
 */
export function getSettingsManager(): SettingsManager {
  settingsManager ??= SettingsManager.create(process.cwd(), resolveAgentDir(), { projectTrusted: false });
  return settingsManager;
}

/** 重置单例（测试隔离：HOME / 环境变量变化后必须重建） */
export function resetModelRuntime(): void {
  runtimePromise = undefined;
  settingsManager = undefined;
}

/** 本地重载模型目录与凭据可用性（不联网）：外部编辑 models.json / 环境变量变化后立即可见 */
export async function reloadModelRuntime(runtime: ModelRuntime): Promise<void> {
  await runtime.refresh({ allowNetwork: false });
}

/** 激活模型选择（provider + model 成对） */
export interface ActiveModelSelection {
  provider: string;
  modelId: string;
}

/**
 * 激活模型解析（GET /settings/llm 展示与 PUT 校验共用）：
 * pi settings 的 defaultProvider+defaultModel → 首个有凭据的可用模型 → null（什么都没配）。
 */
export async function resolveActiveSelection(
  runtime: ModelRuntime,
  settings: SettingsManager,
): Promise<ActiveModelSelection | null> {
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  if (provider !== undefined && modelId !== undefined && runtime.getModel(provider, modelId) !== undefined) {
    return { provider, modelId };
  }
  const first = (await runtime.getAvailable())[0];
  return first === undefined ? null : { provider: first.provider, modelId: first.id };
}

/**
 * 把 pi settings 的当前激活模型 / 思考强度应用到既有会话（「配置变更仅影响新请求」落地）。
 * 会话池按项目+会话复用时，设置页改过的模型必须在本轮生效，否则 UI 改了模型而对话仍用旧模型。
 * 最佳努力：任何失败都不阻断本轮（chat 路由仍会做凭据预检并给出明确错误）。
 */
export async function applyActiveSettings(runtime: ProjectRuntime): Promise<void> {
  const { modelRuntime, settingsManager: settings, session } = runtime;
  try {
    const selection = await resolveActiveSelection(modelRuntime, settings);
    if (selection !== null) {
      const current = session.model;
      if (current === undefined || current.id !== selection.modelId || current.provider !== selection.provider) {
        const next = modelRuntime.getModel(selection.provider, selection.modelId);
        if (next !== undefined) await session.setModel(next);
      }
    }
    // 思考强度：per-model 覆盖优先于全局缺省（与 pi 的模型切换语义一致）
    const level =
      settings.getModelThinkingLevel(selection?.provider ?? "", selection?.modelId ?? "") ??
      settings.getDefaultThinkingLevel();
    if (level !== undefined && session.thinkingLevel !== level) session.setThinkingLevel(level);
  } catch {
    // 最佳努力：见函数注释
  }
}
