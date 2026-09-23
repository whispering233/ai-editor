// 迁移 010：decompose_jobs 新增 concurrency 列（拆解并发段数快照，2026-09）
//
// **历史迁移（拆解功能已整功能移除，见 CHANGELOG）**：本迁移与 009 保留只为旧库升级链
// 连续（v8 → v9 → v10 → v11；011 再把两表 DROP）。
//
// 纯 DDL（无数据搬移）：v9 库补一列，既有表与数据一概不动。
// 存量 job 行由 `DEFAULT 1` 回填——历史 job 本就是串行执行，回填 1 是事实口径而不是近似。
//
// 幂等：`ALTER TABLE ADD COLUMN` 没有 `IF NOT EXISTS`，手工回退版本号后重跑会撞
// `duplicate column name` ⇒ 写前先查 `PRAGMA table_info`，列已在即跳过（迁移语义幂等：
// 正常路径由 user_version 门控，重复执行只可能来自异常重试）。
// 事务由 runMigrations 保证（up + setUserVersion 原子提交）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v10 新增列 DDL（列序：紧跟 batch_target_chars，与 CREATE_TABLES_SQL 一致） */
const DECOMPOSE_CONCURRENCY_DDL = `
ALTER TABLE decompose_jobs ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 1
`;

/** 表上是否已有某列（幂等守卫：ALTER TABLE ADD COLUMN 无 IF NOT EXISTS） */
function hasColumn(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

const migration010: Migration = {
  version: 10,
  up(db: Db) {
    if (hasColumn(db, "decompose_jobs", "concurrency")) return;
    db.exec(DECOMPOSE_CONCURRENCY_DDL);
  },
};

export default migration010;
