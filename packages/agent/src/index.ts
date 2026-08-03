// @ai-editor/agent 入口
// S7.1 会话管理（session.ts）：历史重建 / 成对裁剪 / 喂回格式 / 末条约束——纯内存、无 I/O
// S7.2 上下文组装（context.ts + prompts.ts）：三层提示词注入 / 聚焦注入 / 工具清单 / 分层 token 预算
// S7.3 主循环（run.ts）：runAgent 三重保险 / 工具调度接口 ToolDispatcher / AgentEvent 事件流
// S7.4 工具调度（executor.ts）：ToolDispatcher 真实现 / 提案内存仓（TTL + 上限 + 项目绑定）
import { TOOLS_PKG_NAME } from "@ai-editor/tools";

export const AGENT_PKG_NAME = "@ai-editor/agent";
export const AGENT_PKG_VERSION = "0.1.0";
export const TOOLS_DEP = TOOLS_PKG_NAME;

export * from "./session.js";
export * from "./prompts.js";
export * from "./context.js";
export * from "./run.js";
export * from "./executor.js";
