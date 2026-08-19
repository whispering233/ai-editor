// 迁移 005：参考资料实体（决策 36，批次九）——entities 表 type CHECK 扩为 7 种（含 'reference'）
//
// 背景：v4 的 entities.type CHECK 不含 'reference'（第 7 种实体类型，参考资料：外部素材/灵感笔记，
// 非本书正文，决策 24 边界）。SQLite 的 CHECK 约束无法 ALTER 修改——必须「建新表 → 拷数据 →
// drop 旧表 → rename」四步（与 002/003 同款模式）。
//
// 安全性：entities 无外键引用（relation_records/delta_records 均无 FOREIGN KEY 子句），四步换表
// 不涉及引用完整性；reference 复用既有列（id/type/name/data/sort_order/created_at/updated_at/
// deleted_at），无 DDL 数据搬移，仅 CHECK 扩枚举。事务由 runMigrations 保证（up + setUserVersion
// 原子提交，抛错整体回滚）；幂等性由 user_version 门控（版本已到 5 不再执行）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v5 entities 表 DDL——列序与 schema.ts 的 CREATE_TABLES_SQL 一致（CHECK 含 'reference'） */
const ENTITIES_V5_DDL = `
CREATE TABLE entities_v5 (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event', 'timepoint', 'reference')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  sort_order  INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
)
`;

const migration005: Migration = {
  version: 5,
  up(db: Db) {
    // 1. 建新表（v5 结构：CHECK 含 reference）
    db.exec(ENTITIES_V5_DDL);
    // 2. 拷数据（全部列——v4→v5 无新列，仅 CHECK 扩枚举；reference 从空起步）
    db.exec(
      `INSERT INTO entities_v5 (id, type, name, data, sort_order, created_at, updated_at, deleted_at)
       SELECT id, type, name, data, sort_order, created_at, updated_at, deleted_at FROM entities`,
    );
    // 3. 删旧表
    db.exec("DROP TABLE entities");
    // 4. 新表更名为 entities
    db.exec("ALTER TABLE entities_v5 RENAME TO entities");
  },
};

export default migration005;
