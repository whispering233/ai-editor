// 迁移 012：练习两表——新增 practice_targets / practice_samples（2026-10）
//
// 文风仿写练习是**独立工作区**（`kind = "practice"`），数据落在专属两表（语义与不变式见
// docs/design/60-practice.md §3、docs/design/10-data-model.md §16）。
//
// 纯 DDL 迁移（无数据搬移）：v11 库补建两张新表（含 `idx_practice_samples_target` 索引），
// 既有表与数据一概不动——旧项目没有练习行，**无需回填**。表结构与建库路径共用同一份声明
// （tables.ts 的 CREATE_TABLES_SQL），本文件的 DDL 与之**逐字同形**。
//
// 幂等：CREATE TABLE IF NOT EXISTS——手工回退版本号后重跑（异常重试路径）不报错；
// 正常路径由 user_version 门控（版本已到 12 不再执行）。事务由 runMigrations 保证
// （up + setUserVersion 原子提交）。
//
// **不再建 `idx_practice_samples_target`**（2026-10 修订）：该索引服务于旧的按目标列样本，
// 而 013 已整表拆除旧模型（建索引语句会先于 013 执行）。保留它会与「回退版本号后重跑」冲突：
// v13 库（新形状的 `practice_samples`）重跑 012 时 `CREATE INDEX ... (target_id)` 报
// “no such column: target_id”——而索引的存在对升级链终态没有影响（013 反正要删），故直接不建。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v12 练习两表 DDL（列序与 CREATE_TABLES_SQL 一致） */
const PRACTICE_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS practice_targets (
  id          TEXT PRIMARY KEY,   -- 'pt-*'
  name        TEXT NOT NULL,      -- 文风目标名（上限 = 常量 MAX_PRACTICE_TARGET_NAME_CHARS）
  observation TEXT,               -- 用户自己观察到的文风特点（可选；上限 = 常量 MAX_PRACTICE_OBSERVATION_CHARS）
  created_at  TEXT NOT NULL,      -- ISO 8601，应用层写入
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_samples (
  id           TEXT PRIMARY KEY,          -- 'ps-*'
  target_id    TEXT NOT NULL,             -- 'pt-*'（无 FK，存在性由写入侧守卫）
  source_kind  TEXT NOT NULL,             -- 'paste'（MVP 唯一值，不加 CHECK）
  source_label TEXT NOT NULL,             -- 快照来源说明（用户手填）
  text         TEXT NOT NULL,             -- 范文快照（不可变）
  draft        TEXT NOT NULL DEFAULT '',  -- 用户仿写稿（只有用户能写）
  feedback     TEXT,                      -- 点评卡 JSON（AI 产出；NULL = 未点评）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
`;

const migration012: Migration = {
  version: 12,
  up(db: Db) {
    db.exec(PRACTICE_TABLES_DDL);
  },
};

export default migration012;
