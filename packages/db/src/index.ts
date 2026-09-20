// @whispering233/ai-editor-db 入口：导出建表（schema）、连接（connection）、
// JSON 存储（storage/：outline.json / project.json 原子读写，T2.2）、增量迁移（migrations/）
//
// 会话文件（sessions/*.jsonl）不在本包：新格式（pi session v3）的读写归 pi SessionManager
// （agent 包的 pi 运行时），旧 v1 格式只剩迁移 006 用一次的导出辅助（migrations/legacy-sessions.ts，不导出）
export * from "./schema.js";
export * from "./connection.js";
export * from "./storage/atomic.js";
export * from "./storage/outline.js";
export * from "./storage/project.js";
export * from "./queries/migration.js";
export * from "./migrations/index.js";
export * from "./queries/outline-ops.js";
export * from "./queries/entity.js";
export * from "./queries/backup-stats.js";
export * from "./queries/relation.js";
export * from "./queries/delta.js";
export * from "./queries/compute-state.js";
export * from "./queries/trash.js";
export * from "./queries/document.js";
export * from "./queries/decompose.js";
