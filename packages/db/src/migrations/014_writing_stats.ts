// 迁移 014：新增 writing_stats_daily 码字日统计表（2026-11）
//
// 语义与不变式见 `docs/db/schema.md`「writing_stats_daily」、端点见 `docs/api/130-api-writing-stats.md`：
// 按作品、按天累计正文**新增正字数**（只加不扣），`chars > 0` 是表级 CHECK，空日不建行；
// 无外键 / 无软删 / 无索引（主键即日期）。
//
// 纯 DDL 迁移（**无数据搬移**）：旧项目没有历史统计——首次保存正文后才开始累计。
// 幂等：CREATE TABLE IF NOT EXISTS——手工回退版本号后重跑（异常重试路径）不报错；
// 正常路径由 user_version 门控（版本已到 14 不再执行）。事务由 runMigrations 保证
// （up + setUserVersion 原子提交）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v14 码字日统计表 DDL（列序与 CREATE_TABLES_SQL / docs/db/schema.md 逐字同形） */
const WRITING_STATS_DDL = `
CREATE TABLE IF NOT EXISTS writing_stats_daily (
  stat_date  TEXT PRIMARY KEY,   -- 服务端本地日 YYYY-MM-DD（不带时区）
  chars      INTEGER NOT NULL CHECK (chars > 0),  -- 当日累计新增正文字数（只加正增量）
  updated_at TEXT NOT NULL       -- 最后一次累计写入时刻（ISO 8601）
);
`;

const migration014: Migration = {
  version: 14,
  up(db: Db) {
    db.exec(WRITING_STATS_DDL);
  },
};

export default migration014;