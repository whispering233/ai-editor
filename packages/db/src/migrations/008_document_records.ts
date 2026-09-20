// 迁移 008：块文档表——新增 document_records（章正文 / 参考资料正文，2026-09）
//
// 纯 DDL 迁移（无数据搬移）：v7 库补建一张新表，既有表与数据一概不动。
// 旧 `references/` 目录与旧参考资料行**不作兼容读取**（开发阶段口径，见 docs/db/schema.md
// 「document_records — 块文档表」段）——本迁移不碰它们，也不删任何东西。
//
// 幂等：CREATE TABLE IF NOT EXISTS——手工回退版本号后重跑（异常重试路径）不报错；
// 正常路径由 user_version 门控（版本已到 8 不再执行）。事务由 runMigrations 保证
// （up + setUserVersion 原子提交）。
//
// DDL 与 tables.ts 的 CREATE_TABLES_SQL 中的同名段必须逐字同形——新库走 createTables、
// 旧库走本迁移，两条路径建出的表结构需一致（schema.test.ts 的 DDL 对齐断言锁住声明层）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v8 document_records 表 DDL（列序与 CREATE_TABLES_SQL 一致） */
const DOCUMENT_RECORDS_DDL = `
CREATE TABLE IF NOT EXISTS document_records (
  owner_kind   TEXT NOT NULL,   -- 'chapter' | 'reference'（枚举值少且稳定，不加 CHECK）
  owner_id     TEXT NOT NULL,   -- 'ch-*'（章节点 id）| 'ref-*'（参考资料实体 id）
  content      TEXT NOT NULL,   -- 块数组 JSON 字符串（真相；服务端读路径不解析）
  content_text TEXT NOT NULL,   -- 服务端派生的轻量 md 投影（AI 读取/列表摘要/搜索/字数）
  created_at   TEXT NOT NULL,   -- ISO 8601，应用层写入
  updated_at   TEXT NOT NULL,   -- ISO 8601，应用层写入（版本戳：多标签页防覆盖）
  PRIMARY KEY (owner_kind, owner_id)
)
`;

const migration008: Migration = {
  version: 8,
  up(db: Db) {
    db.exec(DOCUMENT_RECORDS_DDL);
  },
};

export default migration008;
