// 迁移 015：新增 document_snapshots 章正文历史快照表（2026-11）
//
// 语义与不变式见 `docs/db/schema.md`「document_snapshots」、端点为 `docs/api/110-api-manuscript.md`
// 「章级历史」：保存时把被覆盖的旧内容压一份用于误操作找回；`seq` 自增主键是唯一排序键
// （同秒多次保存也稳定），`char_count` 只记字数（不存 content_text，恢复时由服务端重算）。
// 上限（单章份数 + 全书字数预算）与节流间隔是 shared 常量，由写入 / 裁剪侧执行。
//
// 纯 DDL 迁移（**无数据搬移**）：旧项目没有历史快照——首次保存正文后才开始积累。
// 幂等：CREATE TABLE/INDEX IF NOT EXISTS——手工回退版本号后重跑（异常重试路径）不报错；
// 正常路径由 user_version 门控（版本已到 15 不再执行）。事务由 runMigrations 保证
// （up + setUserVersion 原子提交）。
//
// DDL 与 tables.ts 的 CREATE_TABLES_SQL 中的同名段必须逐字同形——新库走 createTables、
// 旧库走本迁移，两条路径建出的表结构需一致（schema.test.ts 的 DDL 对齐断言锁住声明层）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v15 document_snapshots 表与索引 DDL（列序与 CREATE_TABLES_SQL 一致） */
const DOCUMENT_SNAPSHOTS_DDL = `
CREATE TABLE IF NOT EXISTS document_snapshots (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- 自增排序键（同秒多次保存不会打乱顺序）
  owner_kind TEXT NOT NULL,    -- 'chapter'（本期只压章正文）
  owner_id   TEXT NOT NULL,    -- 章节点 id
  content    TEXT NOT NULL,    -- 被覆盖的旧块数组 JSON 字符串
  char_count INTEGER NOT NULL, -- 该快照正文字数（恢复时投影由服务端重算）
  created_at TEXT NOT NULL     -- ISO 8601，应用层写入
);

CREATE INDEX IF NOT EXISTS idx_document_snapshots_owner ON document_snapshots (owner_kind, owner_id, seq);
`;

const migration015: Migration = {
  version: 15,
  up(db: Db) {
    db.exec(DOCUMENT_SNAPSHOTS_DDL);
  },
};

export default migration015;