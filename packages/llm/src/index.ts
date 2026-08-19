// @whispering233/ai-editor-llm 入口（决策 34，批次九重写：pi-ai 引擎换核）
// 职责：只管「怎么调模型」（architecture.md 分包）——模型目录查询 + 流式调用（adapter 适配 pi-ai）
// 重试/错误分类（retry.ts） token 估算（token.ts）对话组织在 agent 包
import { SHARED_PKG_NAME } from "@whispering233/ai-editor-shared";

export * from "./types.js";
export * from "./client.js";
export * from "./adapter.js";
export * from "./retry.js";
export * from "./token.js";

export const LLM_PKG_NAME = "@whispering233/ai-editor-llm";
export const LLM_PKG_VERSION = "0.1.0";
// 验证 workspace 依赖在类型与运行时均可解析
export const SHARED_DEP = SHARED_PKG_NAME;
