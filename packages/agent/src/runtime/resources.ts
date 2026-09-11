// pi 运行时：资源加载选项（本项目对 pi 发现的收窄）
//
// 收窄三件事（见 docs/design/architecture.md「AI 运行时」与 docs/design/config.md）：
// 1. 不加载扩展 —— 项目目录可能来自他人（备份包/共享目录），其中的可执行扩展是安全面而非能力面；
// 2. 不加载技能与提示词模板 —— 工具集固定，多一个资源来源就多一处不可见状态；
// 3. AGENTS.md 只认项目根那一个文件 —— pi 默领会向上遍历祖先目录并读 agent dir，
//    那会把创作根之外（甚至 HOME）的规则悄悄注进对话。

import { existsSync, readFileSync } from "node:fs";
import type { CreateAgentSessionServicesOptions } from "@earendil-works/pi-coding-agent";
import { projectAgentsFilePath } from "./paths.js";
import { KERNEL_PROMPT } from "./system-prompt.js";

/** pi 资源加载选项（cwd/agentDir/settingsManager 由 SDK 填充，此处只给行为开关） */
export type ResourceLoaderOptions = NonNullable<CreateAgentSessionServicesOptions["resourceLoaderOptions"]>;

/** 项目根 AGENTS.md 内容（不存在/不可读 → null；读取失败不阻塞会话装配） */
export function readProjectAgentsFile(projectRoot: string): { path: string; content: string } | null {
  const path = projectAgentsFilePath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return { path, content: readFileSync(path, "utf8") };
  } catch {
    return null;
  }
}

/**
 * 资源加载选项：内核提示词作 system prompt 主体 + 只注入项目根 AGENTS.md。
 * `agentsFilesOverride` 忽略 pi 的发现结果（祖先目录 + agent dir），只回项目根文件。
 */
export function buildResourceLoaderOptions(projectRoot: string): ResourceLoaderOptions {
  return {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    systemPrompt: KERNEL_PROMPT,
    agentsFilesOverride: () => {
      const agentsFile = readProjectAgentsFile(projectRoot);
      return { agentsFiles: agentsFile === null ? [] : [agentsFile] };
    },
  };
}
