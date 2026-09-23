// 迁移 011：删除 decompose_jobs / decompose_batches 两表（2026-09）
//
// 「拆解小说」功能已整功能移除（见 CHANGELOG 的 Removed 段）：两表不再有读写方，
// 随本迁移从库中清掉。**纯 DDL**（无数据搬移）——既有表与数据一概不动。
//
// 幂等：`DROP TABLE IF EXISTS`——表本就不存在（v8 及更早的库 / 手工回退版本号后重跑）
// 也不报错；正常路径由 user_version 门控（版本已到 11 不再执行）。事务由 runMigrations
// 保证（up + setUserVersion 原子提交）。
//
// 009 / 010 两个拆解迁移文件**保留**——旧库升级链必须连续（v8 → v9 → v10 → v11），
// 本迁移是该链的终点（先建两表、后裁决删掉，历史版本库都能收敛到当前 SCHEMA_VERSION）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v10 → v11：两表连索引一并删除（先删批表、再删 job 表，无外键但保持引用顺序可读） */
const DROP_DECOMPOSE_TABLES_DDL = `
DROP TABLE IF EXISTS decompose_batches;
DROP TABLE IF EXISTS decompose_jobs;
`;

const migration011: Migration = {
  version: 11,
  up(db: Db) {
    db.exec(DROP_DECOMPOSE_TABLES_DDL);
  },
};

export default migration011;
