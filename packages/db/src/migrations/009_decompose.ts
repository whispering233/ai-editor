// 迁移 009：拆解小说两表——新增 decompose_jobs / decompose_batches（2026-09）
//
// **历史迁移（拆解功能已整功能移除，见 CHANGELOG）**：本迁移与 010 保留只为旧库升级链
// 连续（v8 → v9 → v10 → v11；011 再把两表 DROP）；新库不再建这两张表（tables.ts 已删声明）。
//
// 纯 DDL 迁移（无数据搬移）：v8 库补建两张新表，既有表与数据一概不动。
// 拆解是新增能力，旧项目没有 job 行，**无需回填**。
//
// 幂等：CREATE TABLE IF NOT EXISTS——手工回退版本号后重跑（异常重试路径）不报错；
// 正常路径由 user_version 门控（版本已到 9 不再执行）。事务由 runMigrations 保证
// （up + setUserVersion 原子提交）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v9 拆解两表 DDL（列序与 CREATE_TABLES_SQL 一致） */
const DECOMPOSE_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS decompose_jobs (
  id                 TEXT PRIMARY KEY,   -- 'job-*'
  status             TEXT NOT NULL,      -- pending | running | paused | done | failed（枚举值少且稳定，不加 CHECK）
  scope_start        INTEGER NOT NULL,   -- 分析范围起始章序（1-based，文件位置序）
  scope_end          INTEGER NOT NULL,
  batch_target_chars INTEGER NOT NULL,   -- 组批目标字数快照（续拆/重跑按同一口径重算批次）
  model              TEXT,               -- 本次使用的模型（provider/id），审计用
  merge_written      TEXT,               -- JSON: 上次归并写入清单（幂等/重跑三路比对）
  error              TEXT,               -- job 级失败摘要
  created_at         TEXT NOT NULL,      -- ISO 8601，应用层写入
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decompose_batches (
  job_id      TEXT NOT NULL,             -- → decompose_jobs.id
  seq         INTEGER NOT NULL,          -- 1-based 批序号（文件位置序）
  chapter_ids TEXT NOT NULL,             -- JSON: 本批覆盖的章节点 id 列表（顺序 = 文件序）
  status      TEXT NOT NULL,             -- pending | running | done | failed
  result      TEXT,                      -- JSON: 该批抽取结果（逐章对齐；未完成 = NULL）
  attempts    INTEGER NOT NULL DEFAULT 0,-- 已尝试次数（重试上限见设计文档）
  error       TEXT,                      -- 该批失败摘要
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
)
`;

const migration009: Migration = {
  version: 9,
  up(db: Db) {
    db.exec(DECOMPOSE_TABLES_DDL);
  },
};

export default migration009;
