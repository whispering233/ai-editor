// @ai-editor/llm 入口（S6.1：模型接入层）
// 职责：只管「怎么调模型」（architecture.md 分包）——fetch → DeepSeek（OpenAI 兼容），
// 手写 SSE 解码 + 流式 tool_call 累积；对话组织在 agent 包，重试 / token 在 S6.2
import { SHARED_PKG_NAME } from "@ai-editor/shared";

export * from "./types.js";
export * from "./client.js";

export const LLM_PKG_NAME = "@ai-editor/llm";
export const LLM_PKG_VERSION = "0.1.0";
// 验证 workspace 依赖在类型与运行时均可解析
export const SHARED_DEP = SHARED_PKG_NAME;
