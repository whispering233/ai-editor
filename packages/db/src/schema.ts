// @whispering233/ai-editor-db schema 版本管理与建表入口（T2.1）
//
// 建表 DDL 常量已迁至 tables.ts（双份声明 + 对齐断言），本文件只保留版本工具。
// 时间约定（）：所有时间列统一 ISO 8601 字符串、由应用层写入，
// 不使用 SQLite 内置 datetime('now')——回收站按 deleted_at 排序需跨 SQLite 与 outline.json 统一格式。

import type Database from "better-sqlite3";
import { CREATE_TABLES_SQL } from "./tables.js";

/**
 * data.db 当前 schema 版本（SCHEMA_VERSION = 2 起由增量迁移驱动）。
 * v1 → v2（ 时间轴）：entities 表 type CHECK 扩为 5 种（含 event）+ 新增
 * sort_order 列——旧 v1 库经 migrations/002_event_timeline.ts 迁移，新库直接建 v2 结构。
 * v2 → v3（G2 时间标签点实体化）：entities 表 type CHECK 扩为 6 种
 * （含 timepoint）+ 旧 event.data.time_label 由 migrations/003_timepoint.ts 迁移为
 * timepoint 实体 + occurs_at 挂载关系（从 event.data 移除 time_label）。
 * v3 → v4（ K2 修订，2026-08）：**无 DDL**——仅 entities.data JSON 数据迁移
 * （setting 的旧 rules 分类值复制到 data.tags 并移除 rules，migrations/004_setting_tags.ts）。
 */
export const SCHEMA_VERSION = 5; // +reference（005_reference.ts 四步换表）

/**
 * 建表：执行全部 DDL（CREATE TABLE/INDEX IF NOT EXISTS，定义于 tables.ts），幂等，可重复调用。
 * 打开数据库后由 connection.openDatabase 自动调用。
 */
export function createTables(db: Database.Database): void {
  db.exec(CREATE_TABLES_SQL);
}

/** 读取 data.db schema 版本（以 PRAGMA user_version 为准判定是否重建） */
export function getUserVersion(db: Database.Database): number {
  return db.pragma("user_version", { simple: true }) as number;
}

/**
 * 写入 data.db schema 版本。
 * 首次初始化时写入 SCHEMA_VERSION，与 outline.json / project.json 顶层 schema_version 同步。
 * 入参必须是整数（user_version 为 SQLite 整数 PRAGMA），非整数直接抛错，杜绝模板拼接的注入面。
 */
export function setUserVersion(db: Database.Database, version: number): void {
  if (!Number.isInteger(version)) {
    throw new Error(`setUserVersion: version 必须是整数，收到 ${String(version)}`);
  }
  db.pragma(`user_version = ${version}`);
}
