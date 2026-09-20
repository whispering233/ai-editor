// 拆解管线的模型调用底座（S2 批抽取 / S3 别名归并 / S4 报告共用）。
//
// **一律走 pi 的 Agent 路径**（2026-09 裁决）：不自建 fetch、不直连 `ModelRuntime.completeSimple`。
// 理由：provider 特化行为（如 opencode 系的 `x-opencode-session`，缺则 400 MissingSessionID）、
// 重试/超时设置（`getProviderRetrySettings`）、思考档位都**只在 pi 的 Agent 包装层生效**
// （`pi-coding-agent` core/sdk.js 的 streamFn → `transformHeaders` → `mergeProviderAttributionHeaders`），
// 自己补一遍等于「无限期跟随上游」。
//
// 形态 = **每次调用一枚新会话**：
// - services：`noExtensions` / `noSkills` / `noPromptTemplates` / `noContextFiles` + 本次的 system prompt
//   （拆解提示词自包含：不注入 pi 内核提示词、不注入项目 AGENTS.md）
// - 会话：`SessionManager.inMemory(cwd, { id: sessionId })` ⇒ **不落会话文件**；会话 id 就是 pi 的会话身份，
//   opencode 系的会话头由 pi 自动带上
// - 每次调用新建会话：不跨批累积上下文 ⇒ 不会触发 auto-compaction 改写后续批次的提示词
// - `noTools: "all"`：拆解不需要任何工具（模型只产出 JSON）
//
// 模型目录 / 凭据 / settings 全经 server 的 `getModelRuntime()` / `getSettingsManager()` 单例，
// 出站统一走启动时装好的全局 undici dispatcher（http-dispatcher.ts）。`deps` 可注入：测试用
// faux provider 离线跑通，不触网。

import { contentText, parseJsonWithRepair, type AssistantMessage } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  SessionManager,
  type ModelRuntime,
  type SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { resolveAgentDir } from "@whispering233/ai-editor-agent";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../model-runtime.js";

/** 拆解管线的可注入依赖（缺省走 pi 单例；同一份依赖贯穿 S2 / S3 / S4） */
export interface DecomposeLlmDeps {
  runtime?: ModelRuntime;
  settings?: SettingsManager;
  /** 资源加载与会话 cwd（拆解传项目根）；缺省 `process.cwd()` */
  cwd?: string;
}

/** 单次补全入参（系统提示 = 角色与输出契约；用户消息 = 本次素材） */
export interface ModelRequest {
  system: string;
  user: string;
}

/** pi 资源加载选项（cwd / agentDir / settingsManager 由 SDK 填充，此处只给行为开关） */
type ResourceLoaderOptions = NonNullable<
  Parameters<typeof createAgentSessionServices>[0]["resourceLoaderOptions"]
>;

/**
 * 拆解用的资源加载选项：四项全关（扩展 / 技能 / 提示词模板 / 上下文文件=AGENTS.md），
 * system prompt = 本次调用的 system（拆解提示词自包含，不掺 pi 内核提示词）。
 */
function decomposeResourceOptions(systemPrompt: string): ResourceLoaderOptions {
  return {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noContextFiles: true,
    systemPrompt,
  };
}

/**
 * 把我们的 job id 适配到 pi 的会话 id 约束（`SessionManager` 校验：非空、只允许 [A-Za-z0-9._-]、
 * 首尾必须是字母数字）。我们的 id 是 `job-<nanoid>`，而 nanoid 字母表含 `-`/`_` ⇒ **可能以 `-` 结尾**
 * （实测踩到过），直接当会话 id 会抛错。清不出合法 id 时返回 `undefined`（交给 pi 自生成）。
 */
export function piSessionId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[^A-Za-z0-9]+/, "")
    .replace(/[^A-Za-z0-9]+$/, "");
  return cleaned === "" ? undefined : cleaned;
}

/**
 * 单次补全（**无工具、单轮**的 pi 会话）：建 services → 建内存会话 → prompt → 取末条 assistant 文本 → dispose。
 *
 * `sessionId`：拆解传 job id（同一 job 的 S2/S3/S4 调用共用一枚稳定会话身份；它同时是
 * opencode 系 provider 的会话头来源——由 pi 注入，本模块不自己拼头）。
 * 缺模型 / 缺凭据 / 模型报错一律抛错（调用方决定重试或落失败）。
 */
export async function completeOnce(
  deps: DecomposeLlmDeps,
  request: ModelRequest,
  sessionId?: string,
): Promise<string> {
  const runtime = deps.runtime ?? (await getModelRuntime());
  const settings = deps.settings ?? getSettingsManager();
  const selection = await resolveActiveSelection(runtime, settings);
  if (selection === null) throw new Error("未配置可用模型：请先在设置页选择模型");
  if (!runtime.hasConfiguredAuth(selection.provider)) {
    throw new Error(`未配置 ${selection.provider} 的凭据：请在设置页填写 API key`);
  }
  const model = runtime.getModel(selection.provider, selection.modelId);
  if (model === undefined) throw new Error(`模型不可用: ${selection.provider}/${selection.modelId}`);

  const cwd = deps.cwd ?? process.cwd();
  const services = await createAgentSessionServices({
    cwd,
    agentDir: resolveAgentDir(),
    settingsManager: settings,
    modelRuntime: runtime,
    resourceLoaderOptions: decomposeResourceOptions(request.system),
  });
  const sessionIdForPi = piSessionId(sessionId);
  const sessionManager = SessionManager.inMemory(cwd, sessionIdForPi === undefined ? undefined : { id: sessionIdForPi });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model,
    noTools: "all",
  });

  try {
    await session.prompt(request.user);
    const assistant = lastAssistantMessage(session.messages);
    if (assistant === undefined) throw new Error("模型没有返回 assistant 消息");
    if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
      throw new Error(assistant.errorMessage ?? `模型调用失败（${assistant.stopReason}）`);
    }
    return contentText(assistant.content);
  } finally {
    session.dispose();
  }
}

/** 末条 assistant 消息（pi 的会话消息里工具结果/用户消息可能排在后面，故从尾部找 assistant） */
function lastAssistantMessage(messages: readonly { role: string }[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message !== undefined && message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

/** 取模型输出里的 JSON 对象：容忍 ```json 围栏与前后解释文字（模型常见形态）；坏 JSON 抛错 → 调用方定夺 */
export function parseModelJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型输出里找不到 JSON 对象");
  return parseJsonWithRepair<unknown>(body.slice(start, end + 1));
}
