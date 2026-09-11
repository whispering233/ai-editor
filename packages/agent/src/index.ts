// @whispering233/ai-editor-agent 入口
//
// 旧内核（自建循环/上下文/会话/调度）：session.ts / prompts.ts / context.ts / run.ts / executor.ts
// —— K3 删除；此前保持导出以兼容 server 层的过渡期调用。
// pi 运行时（换内核后的事实来源）：runtime/ —— 模型/凭据/会话/循环都由 pi 承担，
// 本包负责装配（ModelRuntime + SessionManager + AgentSession）、内核提示词、工具适配与事件映射。

import { TOOLS_PKG_NAME } from "@whispering233/ai-editor-tools";

export const AGENT_PKG_NAME = "@whispering233/ai-editor-agent";
export const AGENT_PKG_VERSION = "0.1.0";
export const TOOLS_DEP = TOOLS_PKG_NAME;

export * from "./session.js";
export * from "./context.js";
export * from "./run.js";
export * from "./executor.js";

// pi 运行时（显式列举：旧 prompts.ts 的 KERNEL_PROMPT 已废弃，不再从包根转发）
export {
  AGENTS_FILE_NAME,
  createCustomTools,
  createPingFrame,
  createProposalSink,
  createProjectRuntime,
  createSessionFrame,
  buildResourceLoaderOptions,
  estimateTokens,
  extractText,
  FOCUS_TITLE,
  getThinkingPreview,
  KERNEL_PROMPT,
  NoModelConfiguredError,
  projectAgentsFilePath,
  projectMessageForWire,
  projectSessionsDir,
  readProjectAgentsFile,
  resolveAgentDir,
  resolveDefaultModel,
  SESSIONS_DIR_NAME,
  stringifyToolResult,
  THINKING_PREVIEW_MAX_CHARS,
  toProposalPayload,
  toSseFrame,
  TOOL_RESULT_MAX_TOKENS,
  truncateToolResultText,
} from "./runtime/index.js";

export type {
  CreateCustomToolsOptions,
  CreateProposalSinkOptions,
  ProjectRuntime,
  ProjectRuntimeInput,
  ProposalPayload,
  ProposalSink,
  ProposalSinkInput,
  ResourceLoaderOptions,
  SseFrame,
  SseProjectionOptions,
  ThinkingLevel,
  ThinkingPreviewProjection,
  WireMessage,
  WireToolCall,
} from "./runtime/index.js";
