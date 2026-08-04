// @whispering233/ai-editor-llm 入口（S6.1 + S6.2：模型接入层）
// 职责：只管「怎么调模型」（architecture.md 分包）——fetch → DeepSeek（OpenAI 兼容），
// 手写 SSE 解码 + 流式 tool_call 累积（client.ts）、重试与错误分类（retry.ts）、
// token 估算与工具结果截断（token.ts）；对话组织在 agent 包
import { SHARED_PKG_NAME } from "@whispering233/ai-editor-shared";

export * from "./types.js";
export * from "./client.js";
export * from "./retry.js";
export * from "./token.js";

export const LLM_PKG_NAME = "@whispering233/ai-editor-llm";
export const LLM_PKG_VERSION = "0.1.0";
// 验证 workspace 依赖在类型与运行时均可解析
export const SHARED_DEP = SHARED_PKG_NAME;
