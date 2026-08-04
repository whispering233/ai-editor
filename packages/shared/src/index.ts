// @whispering233/ai-editor-shared 入口
// 硬约束：禁止引入任何 Node.js 内置模块或服务端专用包（见 doc/design/architecture.md）
// 内容划分：types/（数据类型，类型-only barrel）+ constants/ + utils/（纯函数）
// **客户端打包安全**：从根导入不包含任何 zod 运行时代码（api.ts 的运行时 schema
// 仅经 @whispering233/ai-editor-shared/schemas 子路径导出，供服务端使用）
export type * from "./types/index.js";
export * from "./constants/index.js";
export * from "./utils/index.js";

export const SHARED_PKG_NAME = "@whispering233/ai-editor-shared";
export const SHARED_PKG_VERSION = "0.1.0";
