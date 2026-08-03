// @ai-editor/agent 入口
// S7.1 会话管理（session.ts）：历史重建 / 成对裁剪 / 喂回格式 / 末条约束——纯内存、无 I/O
import { TOOLS_PKG_NAME } from "@ai-editor/tools";

export const AGENT_PKG_NAME = "@ai-editor/agent";
export const AGENT_PKG_VERSION = "0.1.0";
export const TOOLS_DEP = TOOLS_PKG_NAME;

export * from "./session.js";
