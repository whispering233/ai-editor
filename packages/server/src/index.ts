// @ai-editor/server 入口（空壳）
import { AGENT_PKG_NAME } from "@ai-editor/agent";
// 验证 hono 类型解析（HTTP 路由在后续卡实现）
export type { Hono } from "hono";

export const SERVER_PKG_NAME = "@ai-editor/server";
export const SERVER_PKG_VERSION = "0.1.0";
export const AGENT_DEP = AGENT_PKG_NAME;
