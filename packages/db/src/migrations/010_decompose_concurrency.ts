// 迁移 010：decompose_jobs 新增 concurrency 列（拆解并发段数快照，2026-09）
//
// 纯 DDL（无数据搬移）：v9 库补一列，既有表与数据一概不动。
// 存量 job 行由 `DEFAULT 1` 回填——历史 job 本就是串行执行，回填 1 是事实口径而不是近似
// （见 docs/db/schema.md「decompose_jobs / decompose_batches」不变式表「并发快照」）。
//
// 幂等：`ALTER TABLE ADD COLUMN` 没有 `IF NOT EXISTS`，手工回退版本号后重跑会撞
// `duplicate column name` ⇒ 写前先查 `PRAGMA table_info`，列已在即跳过（迁移语义幂等：
// 正常路径由 user_version 门控，重复执行只可能来自异常重试）。
// 事务由 runMigrations 保证（up + setUserVersion 原子提交）。
//
// DDL 与 tables.ts 的 CREATE_TABLES_SQL 中 decompose_jobs 段保持同形（新库走 createTables、
// 旧库走本迁移）：本迁移带 DEFAULT（存量行要回填），新库 DDL 不带（写入侧恒显式给值）；
// 两条路径建出的列类型 / NOT NULL 一致，schema.test.ts 的 DDL 对齐断言锁住声明层。

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
