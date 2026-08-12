// @whispering233/ai-editor-db 建表 SQL 与 schema 版本管理（T2.1）
//
// 单一事实来源：doc/database/schema.md——列名/类型/CHECK/索引逐字对照，勿在此处自行改动结构。
// 时间约定（schema.md 第 16 行）：所有时间列统一 ISO 8601 字符串、由应用层写入，
// 不使用 SQLite 内置 datetime('now')——回收站按 deleted_at 排序需跨 SQLite 与 outline.json 统一格式。

import type Database from "better-sqlite3";

/**
 * data.db 当前 schema 版本（决策 13；SCHEMA_VERSION = 2 起由增量迁移驱动，E5）。
 * v1 → v2（决策 26 时间轴）：entities 表 type CHECK 扩为 5 种（含 event）+ 新增
 * sort_order 列——旧 v1 库经 migrations/002_event_timeline.ts 迁移，新库直接建 v2 结构。
 */
export const SCHEMA_VERSION = 2;

/**
 * 四张业务表 + 索引的建表 SQL（幂等：CREATE TABLE/INDEX IF NOT EXISTS）。
 *
 * - entities          实体（character/setting/location/hook/event），type 受 CHECK 约束，data 存 JSON，
 *                     sort_order 为时间轴事件全局线性序（仅 event 使用，其余类型 NULL，决策 26），软删列 deleted_at（决策 12）
 * - relation_records  通用关系表（含 plot_edge 剧情连线、occurs_in 事件锚定，决策 26），
 *                     3 个部分索引 WHERE deleted_at IS NULL（决策 12 修订）
 * - delta_records     属性变更记录（"order" 列引号保留——ORDER 是 SQLite 关键字）
 * - chat_messages     对话历史（决策 18），含 project_id/tool_call_id，会话索引 (session_id, created_at)
 */
export const CREATE_TABLES_SQL = `
-- entities：实体表（人物/设定/地点/伏笔/时间轴事件）
CREATE TABLE IF NOT EXISTS entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',  -- JSON: 各类型的专属字段
  sort_order  INTEGER,         -- 时间轴事件全局线性序（决策 26）：仅 event 使用，其余类型 NULL
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对，决策 14）
  deleted_at  TEXT             -- 软删标记（决策 12），NULL 表示未删除；非 NULL 时该实体进入回收站，本体保留可还原
);

-- relation_records：通用关系表
CREATE TABLE IF NOT EXISTS relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,             -- 端点类型：实体 'character'|'setting'|'location'|'hook'|'event'，大纲节点 'outline_node'
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata      TEXT,             -- JSON 扩展元数据
  created_at    TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at    TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对，决策 14；软删/还原亦更新，决策 12 修订）
  deleted_at    TEXT              -- 级联软删标记（决策 12）：仅实体/节点级联删除时写入；
                                  -- 手动删除关系 = 物理删（不置 deleted_at，不进入回收站）
);

-- 索引（决策 12 修订补）：k 跳遍历与高频关系查询（部分索引，仅覆盖未软删行）
CREATE INDEX IF NOT EXISTS idx_relation_source ON relation_records(source_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relation_target ON relation_records(target_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relation_type   ON relation_records(relation_type) WHERE deleted_at IS NULL;

-- delta_records：属性变更表
CREATE TABLE IF NOT EXISTS delta_records (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,       -- 触发变更的大纲节点
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  changes     TEXT NOT NULL,       -- JSON: [{field, op, from?, to?, value?}]
  description TEXT NOT NULL,       -- 人类可读描述
  "order"     INTEGER NOT NULL DEFAULT 0,  -- 同一节点内多个 Delta 的排序（全局单调递增，服务端生成）
  created_at  TEXT NOT NULL,               -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL,               -- ISO 8601，应用层写入（提案快照比对，决策 14）
  deleted_at  TEXT              -- 级联软删标记（决策 12）：仅实体/节点级联删除时写入。
                                -- 可见性联动触发节点与目标实体（决策 12 修订）：任一端软删即不可见
);

-- chat_messages：对话历史表（决策 18，与 data.db 同库）
CREATE TABLE IF NOT EXISTS chat_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  project_id    TEXT NOT NULL,          -- 会话按项目隔离（决策 18 修订）
  role          TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
  content       TEXT,
  tool_calls    TEXT,                   -- JSON: 助手消息的工具调用数组
  tool_call_id  TEXT,                   -- tool 消息关联的 assistant 工具调用 id（决策 18 修订）
  created_at    TEXT NOT NULL           -- ISO 8601，应用层写入
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
`;

/**
 * 建表：执行全部 DDL（CREATE TABLE/INDEX IF NOT EXISTS），幂等，可重复调用。
 * 打开数据库后由 connection.openDatabase 自动调用。
 */
export function createTables(db: Database.Database): void {
  db.exec(CREATE_TABLES_SQL);
}

/** 读取 data.db schema 版本（决策 13：以 PRAGMA user_version 为准判定是否重建） */
export function getUserVersion(db: Database.Database): number {
  return db.pragma("user_version", { simple: true }) as number;
}

/**
 * 写入 data.db schema 版本（决策 13）。
 * 首次初始化时写入 SCHEMA_VERSION，与 outline.json / project.json 顶层 schema_version 同步（决策 8）。
 * 入参必须是整数（user_version 为 SQLite 整数 PRAGMA），非整数直接抛错，杜绝模板拼接的注入面。
 */
export function setUserVersion(db: Database.Database, version: number): void {
  if (!Number.isInteger(version)) {
    throw new Error(`setUserVersion: version 必须是整数，收到 ${String(version)}`);
  }
  db.pragma(`user_version = ${version}`);
}
