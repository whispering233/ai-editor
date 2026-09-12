// @whispering233/ai-editor-agent 入口
//
// 本包 = pi 运行时装配层：模型/凭据/会话/循环都由 pi 承担（见 docs/design/architecture.md「AI 运行时」），
// 本包只负责装配（ModelRuntime + SessionManager + AgentSession）、内核提示词、领域工具适配、
// 事件投影（→ SSE 帧）与提案仓。

import { TOOLS_PKG_NAME } from "@whispering233/ai-editor-tools";

export const AGENT_PKG_NAME = "@whispering233/ai-editor-agent";
export const AGENT_PKG_VERSION = "0.1.0";
export const TOOLS_DEP = TOOLS_PKG_NAME;

export {
  AGENTS_FILE_NAME,
  createCustomTools,
  createPingFrame,
  createProposalSink,
  createProposalStore,
  createProjectRuntime,
  createSessionFrame,
  defaultProposalStore,
  buildResourceLoaderOptions,
  estimateTokens,
  extractText,
  FOCUS_TITLE,
  findProjectSession,
  getThinkingPreview,
  KERNEL_PROMPT,
  lastVisibleSessionText,
  listProjectSessions,
  NoModelConfiguredError,
  openProjectSessionManager,
  projectAgentsFilePath,
  projectMessageForWire,
  projectSessionMessages,
  projectSessionsDir,
  PROPOSAL_BUILDERS,
  PROPOSAL_MAX_COUNT,
  PROPOSAL_TTL_MS,
  readProjectAgentsFile,
  readProjectSession,
  readSessionThinking,
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
  Proposal,
  ProposalStore,
  ProposalStoreOptions,
  ProposalPayload,
  ProposalSink,
  ProposalSinkInput,
  ResourceLoaderOptions,
  SessionEntry,
  SessionInfo,
  SseFrame,
  SseProjectionOptions,
  ThinkingLevel,
  ThinkingPreviewProjection,
  WireMessage,
  WireSessionMessage,
  WireToolCall,
} from "./runtime/index.js";
