// server pi 运行时单例：激活设置应用（配置变更只影响新请求）的单元测试
//
// 覆盖 `applyActiveSettings` 的三条语义：设置指向别的模型 → 切；已一致 → 不切（避免反复写
// model_change entry）；失败不抛穿（最佳努力）。用 pi 的 faux provider + 内存 settings，
// 不碰真实 provider / 不写真实 agent dir。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore, fauxProvider, type Model } from "@earendil-works/pi-ai";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { ProjectRuntime } from "@whispering233/ai-editor-agent";
import { applyActiveSettings, resolveActiveSelection } from "./model-runtime.js";

// 本机可能已设 provider env key：不清掉会让内置 provider 抢在 faux 之前成为「首个可用模型」，
// 断言失去确定性（测试只关心 faux 两个模型之间的切换语义）。
const ENVS = ["DEEPSEEK_API_KEY", "OPENCODE_API_KEY"] as const;
const ORIGINAL_ENVS: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const e of ENVS) {
    ORIGINAL_ENVS[e] = process.env[e];
    delete process.env[e];
  }
});

afterEach(() => {
  for (const e of ENVS) {
    const v = ORIGINAL_ENVS[e];
    if (v !== undefined) process.env[e] = v;
    else delete process.env[e];
  }
});

/** 内存 ModelRuntime：单个 faux provider，两个模型（同一 provider 内切换） */
async function createRuntime(): Promise<{ modelRuntime: ModelRuntime; models: [Model<string>, Model<string>] }> {
  const faux = fauxProvider({
    models: [
      { id: "faux-a", name: "Faux A", contextWindow: 128_000, maxTokens: 8192 },
      { id: "faux-b", name: "Faux B", contextWindow: 128_000, maxTokens: 8192 },
    ],
  });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(faux.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
  const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
  modelRuntime.registerNativeProvider(faux.provider);
  await modelRuntime.refresh({ allowNetwork: false });
  const a = modelRuntime.getModel(faux.provider.id, "faux-a");
  const b = modelRuntime.getModel(faux.provider.id, "faux-b");
  if (a === undefined || b === undefined) throw new Error("faux 模型未进 ModelRuntime");
  return { modelRuntime, models: [a, b] };
}

/** 会话桩：只暴露 applyActiveSettings 触及的成员（model/getter + 两个 setter） */
function createSessionStub(current: Model<string>): {
  session: ProjectRuntime["session"];
  setModel: ReturnType<typeof vi.fn>;
  setThinkingLevel: ReturnType<typeof vi.fn>;
} {
  let model: Model<string> = current;
  let thinkingLevel = "off";
  const setModel = vi.fn(async (next: Model<string>) => {
    model = next;
  });
  const setThinkingLevel = vi.fn((level: string) => {
    thinkingLevel = level;
  });
  const session = {
    get model(): Model<string> {
      return model;
    },
    get thinkingLevel(): string {
      return thinkingLevel;
    },
    setModel,
    setThinkingLevel,
  } as unknown as ProjectRuntime["session"];
  return { session, setModel, setThinkingLevel };
}

function runtimeOf(
  modelRuntime: ModelRuntime,
  settingsManager: SettingsManager,
  session: ProjectRuntime["session"],
): ProjectRuntime {
  return { modelRuntime, settingsManager, session } as unknown as ProjectRuntime;
}

describe("applyActiveSettings（配置变更只影响新请求）", () => {
  it("settings 指向另一个模型 → 切换会话模型；已一致 → 不再切换（幂等）", async () => {
    const { modelRuntime, models } = await createRuntime();
    const [a, b] = models;
    const settings = SettingsManager.inMemory({ defaultProvider: b.provider, defaultModel: b.id });
    const { session, setModel } = createSessionStub(a);

    await applyActiveSettings(runtimeOf(modelRuntime, settings, session));
    expect(setModel).toHaveBeenCalledTimes(1);
    expect(setModel.mock.calls[0]![0].id).toBe(b.id);

    // 第二次：settings 与会话一致 → 无写操作
    await applyActiveSettings(runtimeOf(modelRuntime, settings, session));
    expect(setModel).toHaveBeenCalledTimes(1);
  });

  it("settings 未配置 defaultModel → 沿用会话当前模型（不切）", async () => {
    const { modelRuntime, models } = await createRuntime();
    const [a] = models;
    // 无 defaultModel 时 resolveActiveSelection 回落到「首个可用模型」= faux-a，与会话一致
    const settings = SettingsManager.inMemory({});
    const { session, setModel } = createSessionStub(a);

    await applyActiveSettings(runtimeOf(modelRuntime, settings, session));
    expect(setModel).not.toHaveBeenCalled();
  });

  it("thinking 强度：pi settings 有值时应用；per-model 覆盖优先", async () => {
    const { modelRuntime, models } = await createRuntime();
    const [a] = models;
    const settings = SettingsManager.inMemory({ defaultThinkingLevel: "high" });
    const { session, setThinkingLevel } = createSessionStub(a);

    await applyActiveSettings(runtimeOf(modelRuntime, settings, session));
    expect(setThinkingLevel).toHaveBeenCalledWith("high");

    setThinkingLevel.mockClear();
    settings.setModelThinkingLevel(a.provider, a.id, "low");
    await applyActiveSettings(runtimeOf(modelRuntime, settings, session));
    expect(setThinkingLevel).toHaveBeenCalledWith("low");
  });

  it("切换失败（setModel 抛错）不抛穿——本轮照常继续（chat 路由随后做凭据预检）", async () => {
    const { modelRuntime, models } = await createRuntime();
    const [a, b] = models;
    const settings = SettingsManager.inMemory({ defaultProvider: b.provider, defaultModel: b.id });
    const { session } = createSessionStub(a);
    (session.setModel as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no api key"));

    await expect(applyActiveSettings(runtimeOf(modelRuntime, settings, session))).resolves.toBeUndefined();
  });

  it("resolveActiveSelection：settings 优先 → 首个可用模型 → null", async () => {
    const { modelRuntime, models } = await createRuntime();
    const [a, b] = models;

    const configured = SettingsManager.inMemory({ defaultProvider: b.provider, defaultModel: b.id });
    expect(await resolveActiveSelection(modelRuntime, configured)).toEqual({ provider: b.provider, modelId: b.id });

    const empty = SettingsManager.inMemory({});
    expect(await resolveActiveSelection(modelRuntime, empty)).toEqual({ provider: a.provider, modelId: a.id });
  });
});
