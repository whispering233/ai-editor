// 迁移 002：时间轴事件（决策 26）——entities 表 type CHECK 扩为 5 种 + 新增 sort_order 列
//
// 背景：v1 的 entities.type CHECK 不含 'event'，且无 sort_order 列（时间轴事件全局线性序）。
// SQLite 的 CHECK 约束无法 ALTER 修改——必须「建新表 → 拷数据 → drop 旧表 → rename」四步。
//
// 安全性：entities 无外键引用（relation_records/delta_records 均无 FOREIGN KEY 子句，
// 见 schema.ts CREATE_TABLES_SQL），四步换表不涉及引用完整性；entities 也没有业务索引，
// 无需重建索引。事务由 runMigrations 保证（up + setUserVersion 原子提交，抛错整体回滚）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";

/** v2 entities 表 DDL——列序与 schema.ts 的 CREATE_TABLES_SQL 一致（id/type/name/data/sort_order/created_at/updated_at/deleted_at） */
const ENTITIES_V2_DDL = `
CREATE TABLE entities_v2 (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  sort_order  INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
)
`;

export default {
  version: 2,
  up: (db: Db) => {
    // 1. 建新表（v2 结构：CHECK 含 event + sort_order 列）
    db.exec(ENTITIES_V2_DDL);
    // 2. 拷数据（sort_order 旧库无此列，全部为 NULL——event 时间轴从空序起步，由 move 端点重排）
    db.exec(
      `INSERT INTO entities_v2 (id, type, name, data, created_at, updated_at, deleted_at)
       SELECT id, type, name, data, created_at, updated_at, deleted_at FROM entities`,
    );
    // 3. 删旧表
    db.exec("DROP TABLE entities");
    // 4. 新表更名为 entities
    db.exec("ALTER TABLE entities_v2 RENAME TO entities");
  },
} satisfies Migration;
