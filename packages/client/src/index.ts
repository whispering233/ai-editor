// @ai-editor/client 入口（空壳）
// 架构约束：client 只依赖 @ai-editor/shared（仅类型 + 常量，编译期消失）
import { SHARED_PKG_NAME } from "@ai-editor/shared";

export const CLIENT_PKG_NAME = "@ai-editor/client";
export const CLIENT_PKG_VERSION = "0.1.0";
export const SHARED_DEP = SHARED_PKG_NAME;
