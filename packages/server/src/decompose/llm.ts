// 拆解管线的模型调用底座（卡 21.7 从 runner.ts 提出）：S2 批抽取 / S3 别名归并 / S4 报告共用。
//
// 模型目录 / 凭据 / settings 全经 server 的 `getModelRuntime()` / `getSettingsManager()` 单例，
// **不自建 fetch / agent**（出站统一走启动时装好的全局 undici dispatcher，见 http-dispatcher.ts）。
// `runtime` / `settings` 可注入：测试注入 faux provider 离线跑通，不触网。

import { contentText, parseJsonWithRepair } from "@earendil-works/pi-ai";
import type { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getModelRuntime, getSettingsManager, resolveActiveSelection } from "../model-runtime.js";

/** 拆解管线的可注入依赖（缺省走 pi 单例；同一份依赖贯穿 S2 / S3 / S4） */
export interface DecomposeLlmDeps {
  runtime?: ModelRuntime;
  settings?: SettingsManager;
}

/** 单次补全入参（系统提示 = 角色与输出契约；用户消息 = 本次素材） */
export interface ModelRequest {
  system: string;
  user: string;
}

/**
 * 单次补全（无 agent 循环）：`ModelRuntime.completeSimple`。
 * 模型目录 / 凭据 / settings 全经 server 的 `getModelRuntime()` / `getSettingsManager()` 单例，
 * **不自建 fetch / agent**。缺模型 / 缺凭据 / 模型报错一律抛错（调用方决定重试或落失败）。
 */
export async function completeOnce(deps: DecomposeLlmDeps, request: ModelRequest): Promise<string> {
  const runtime = deps.runtime ?? (await getModelRuntime());
  const selection = await resolveActiveSelection(runtime, deps.settings ?? getSettingsManager());
  if (selection === null) throw new Error("未配置可用模型：请先在设置页选择模型");
  if (!runtime.hasConfiguredAuth(selection.provider)) {
    throw new Error(`未配置 ${selection.provider} 的凭据：请在设置页填写 API key`);
  }
  const model = runtime.getModel(selection.provider, selection.modelId);
  if (model === undefined) throw new Error(`模型不可用: ${selection.provider}/${selection.modelId}`);
  const message = await runtime.completeSimple(model, {
    systemPrompt: request.system,
    messages: [{ role: "user", content: [{ type: "text", text: request.user }], timestamp: Date.now() }],
  });
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? `模型调用失败（${message.stopReason}）`);
  }
  return contentText(message.content);
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
