// 迁移 013：作家文风练习模型重建——旧两表（practice_targets / practice_samples）换为三表
// （practice_samples / practice_free_pieces / practice_style_packs），2026-10
//
// 语义与不变式见 `docs/db/schema.md`「练习三表」、`docs/design/60-practice.md` §5-6：
// 一位预置作家 = 一个练习工作区，故旧「文风目标（practice_targets）+ 目标下 N 个样本」的
// 模型被整体替换——样本改为挂工作区（`work_id` 只是作品清单引用，可为 NULL），
// 新增自由练习篇与风格说明素材包两表。
//
// 纯 DDL 迁移（**无数据搬移**）：旧行随旧表一并丢弃——旧模型的目标/样本没有对应的新归属
// （一个目标 ≠ 一个工作区的作家身份，无法机械映射），且练习数据是可重录的用户草稿。
// 顺序：drop 旧索引 → drop 旧样本表 → drop 旧目标表 → 建三张新表（幂等 DDL）。
//
// 幂等：DROP ... IF EXISTS / CREATE ... IF NOT EXISTS——手工回退版本号后重跑（异常重试路径）
// 不报错；正常路径由 user_version 门控（版本已到 13 不再执行）。事务由 runMigrations 保证
// （up + setUserVersion 原子提交）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v12 旧练习两表的拆除（索引先于表；表已不存在时同样安全） */
const DROP_LEGACY_PRACTICE_DDL = `
DROP INDEX IF EXISTS idx_practice_samples_target;
DROP TABLE IF EXISTS practice_samples;
DROP TABLE IF EXISTS practice_targets;
`;

/** v13 练习三表 DDL（列序与 CREATE_TABLES_SQL / docs/db/schema.md 逐字同形；三表无外键、无索引） */
const PRACTICE_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS practice_samples (
  id            TEXT PRIMARY KEY,          -- 'ps-*'
  work_id       TEXT,                      -- 关联预置作品 id（NULL = 「其他」；无 FK，存在性由写入侧守卫）
  excerpt_label TEXT NOT NULL DEFAULT '',  -- 片段说明（空串 = 未填；上限 = 常量 MAX_PRACTICE_EXCERPT_LABEL_CHARS）
  text          TEXT NOT NULL,             -- 范文快照（不可变；上限 = 常量 MAX_PRACTICE_SAMPLE_CHARS）
  draft         TEXT NOT NULL DEFAULT '',  -- 用户仿写稿（**只有用户能写**）
  feedback      TEXT,                      -- 点评卡 JSON（AI 产出；NULL = 未点评）
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_free_pieces (
  id           TEXT PRIMARY KEY,          -- 'pf-*'
  topic        TEXT NOT NULL DEFAULT '',  -- 题目（空串 = 待出题；上限 = 常量 MAX_PRACTICE_TOPIC_CHARS）
  brief        TEXT NOT NULL DEFAULT '',  -- 写作要求（空串 = 无；上限 = 常量 MAX_PRACTICE_BRIEF_CHARS）
  topic_source TEXT NOT NULL,             -- 'user' | 'ai'（出题来源；也是「待出题」状态的判据）
  draft        TEXT NOT NULL DEFAULT '',  -- 用户稿件（**只有用户能写**；上限同仿写稿常量）
  feedback     TEXT,                      -- 点评卡 JSON（AI 产出；NULL = 未点评）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS practice_style_packs (
  author_id  TEXT PRIMARY KEY,            -- 预置作家 id（shared AUTHOR_CATALOG 的键）
  content    TEXT NOT NULL,               -- 用户对作家风格说明的覆盖（上限 = 常量 MAX_PRACTICE_STYLE_PACK_CHARS）
  updated_at TEXT NOT NULL                -- 无覆盖 = 无行（读侧回退 shared 常量里的预置文本）
);
`;

const migration013: Migration = {
  version: 13,
  up(db: Db) {
    db.exec(DROP_LEGACY_PRACTICE_DDL);
    db.exec(PRACTICE_TABLES_DDL);
  },
};

export default migration013;