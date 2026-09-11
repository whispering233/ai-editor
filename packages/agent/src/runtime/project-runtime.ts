// pi 运行时：一个项目的会话运行时装配
//
// 装配顺序（每步的「为什么」见 docs/design/architecture.md「AI 运行时」）：
//   项目根 + agent dir → SessionManager（项目 sessions/）→ SettingsManager（项目配置不参与）
//   → createAgentSessionServices（ModelRuntime + 资源加载）→ 解析模型 → AgentSession（builtin 工具关闭 + 领域工具）
//
// 一个项目一个运行时实例：server 层在打开/切换项目时创建与释放（单项目单在途流）。

import { resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionServices,
} from "@earendil-works/pi-coding-agent";
import type { ToolContext } from "@whispering233/ai-editor-tools";
import { projectSessionsDir, resolveAgentDir } from "./paths.js";
import { buildResourceLoaderOptions } from "./resources.js";
import { createCustomTools, type ProposalSink } from "./tools.js";

/** 思考强度（取自 AgentSession 的公开签名，避免直接依赖 pi-agent-core 类型） */
export type ThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];

/** 未配置任何可用模型/凭据（装配期失败；调用方决定如何呈现） */
export class NoModelConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoModelConfiguredError";
  }
}

export interface ProjectRuntimeInput {
  /** 项目根目录（AGENTS.md 与 sessions/ 都在这里） */
  projectRoot: string;
  /** 工具执行上下文（db / outlineDir / projectId） */
  toolContext: ToolContext;
  /** pi agent dir 覆盖（缺省 `~/.pi/agent`；测试隔离用） */
  agentDir?: string;
  /** 注入既有 ModelRuntime（测试/复用）；缺省由 SDK 按 agentDir 自建 */
  modelRuntime?: ModelRuntime;
  /** 注入既有 SettingsManager；缺省按「项目配置不参与」自建 */
  settingsManager?: SettingsManager;
  /** 注入既有 SessionManager；缺省按项目 sessions/ 目录自建 */
  sessionManager?: SessionManager;
  /** 显式激活模型；缺省按 pi settings 的 defaultModel / 首个可用模型解析 */
  model?: Model<Api>;
  /** 初始思考强度；缺省按 pi settings 与模型能力解析 */
  thinkingLevel?: ThinkingLevel;
  /** 提案登记回调（K3 接提案仓） */
  proposalSink?: ProposalSink;
}

/** 一个项目的 pi 运行时（会话 + 支撑服务） */
export interface ProjectRuntime {
  /** 会话（prompt/abort/subscribe/dispose 见 pi AgentSession） */
  session: AgentSession;
  /** cwd 绑定的支撑服务（模型运行时 / 设置 / 资源加载器） */
  services: AgentSessionServices;
  sessionManager: SessionManager;
  settingsManager: SettingsManager;
  modelRuntime: ModelRuntime;
  /** 释放会话订阅（项目关闭/切换时调用） */
  dispose(): void;
}

/**
 * 缺省模型解析：pi settings 的 defaultProvider+defaultModel → 首个可用模型（已配凭据者）→ 抛错。
 * 不在本函数兜底到任何硬编码模型——「用哪个模型」归用户配置。
 * 导出供 K5（settings 端点）复用与单测注入（stub runtime）。
 */
export async function resolveDefaultModel(runtime: ModelRuntime, settings: SettingsManager): Promise<Model<Api>> {
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  if (provider !== undefined && modelId !== undefined) {
    const configured = runtime.getModel(provider, modelId);
    if (configured !== undefined) return configured;
  }
  const available = await runtime.getAvailable();
  const first = available[0];
  if (first !== undefined) return first;
  throw new NoModelConfiguredError(
    "未配置可用模型：请先在设置页或 ~/.pi/agent/（auth.json / models.json）配置 provider 凭据",
  );
}

/**
 * 装配一个项目的运行时。
 * 会话文件落 `<项目根>/sessions`（不是 pi 默认的 agent dir 布局）。
 */
export async function createProjectRuntime(input: ProjectRuntimeInput): Promise<ProjectRuntime> {
  const projectRoot = resolve(input.projectRoot);
  const agentDir = resolveAgentDir(input.agentDir);

  const sessionManager =
    input.sessionManager ?? SessionManager.create(projectRoot, projectSessionsDir(projectRoot));
  // 项目配置不参与：项目目录可能来自他人（备份包/共享目录），不接受其中携带的配置
  const settingsManager =
    input.settingsManager ?? SettingsManager.create(projectRoot, agentDir, { projectTrusted: false });

  const services = await createAgentSessionServices({
    cwd: projectRoot,
    agentDir,
    settingsManager,
    ...(input.modelRuntime === undefined ? {} : { modelRuntime: input.modelRuntime }),
    resourceLoaderOptions: buildResourceLoaderOptions(projectRoot),
  });

  const model = input.model ?? (await resolveDefaultModel(services.modelRuntime, settingsManager));

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager,
    model,
    ...(input.thinkingLevel === undefined ? {} : { thinkingLevel: input.thinkingLevel }),
    // builtin（read/bash/edit/write…）全关：本项目不是编码 agent；领域工具是自定义工具，不受此开关影响
    noTools: "builtin",
    customTools: createCustomTools({
      toolContext: input.toolContext,
      ...(input.proposalSink === undefined ? {} : { proposalSink: input.proposalSink }),
    }),
  });

  return {
    session,
    services,
    sessionManager,
    settingsManager,
    modelRuntime: services.modelRuntime,
    dispose: () => session.dispose(),
  };
}
