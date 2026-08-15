// 迁移 003：时间标签点实体化（G2，决策 26 修订）——entities CHECK 扩为 6 种（含 timepoint）
// + 旧 event.data.time_label 迁移为 timepoint 实体 + occurs_at 挂载关系
//
// 背景：v2 的 time_label 是 event.data 内的纯文本字段（F1-F9 形态，仅展示不解析）。
// G2 起时间标签从事件剥离为独立 timepoint 实体（name = 时间标签文本，data 空），
// 事件经 occurs_at 关系（timepoint → event，1:n）挂载。SQLite 无法 ALTER 修改 CHECK——
// 沿用 002 的「建新表 → 拷数据 → drop 旧表 → rename」四步换表。
//
// 安全性：entities 无外键引用（relation_records/delta_records 均无 FOREIGN KEY 子句，
// 见 schema.ts CREATE_TABLES_SQL），四步换表不涉及引用完整性；relation_records 的
// type 列无 CHECK，occurs_at 挂载关系直接 INSERT，无需换表。事务由 runMigrations 保证
// （up + setUserVersion 原子提交，抛错整体回滚——含换表与全部数据写入）。
//
// 数据迁移语义（与 002 只做换表不同，003 在 up 内完成全部数据动作）：
// 1. 读全部**未软删** event（软删事件完全跳过：不建 timepoint、不建关系、不改 data），
//    按事件全局线性序（sort_order 升序、NULL 沉底、id 稳定次序）逐条处理
// 2. 解析 data JSON 取 time_label（trim 后非空才视为标签；非字符串/坏 JSON/空串 → 未挂载，
//    不建关系、不改 data——防御，不做宽松猜测）
// 3. 按 trim 后标签值聚合：**同名合并为同一 timepoint**（id 沿用 createEntity 的
//    generateEntityId 机制 → tp- 前缀，name = 标签文本，data = '{}'），sort_order 按
//    各组首个事件在列表中的出现序赋 0..n-1
// 4. 每个带标签事件建一条 occurs_at 关系（source=timepoint、target=event，id 沿用
//    generateId("rel-") 机制，与 createRelation 同款）
// 5. 从这些事件的 data 中移除 time_label 键并刷新 updated_at（迁移改写数据——版本戳
//    刷新使旧提案快照自动失效，与决策 14 语义一致）
//
// 幂等性：迁移只执行一次（runMigrations 以 user_version 门控：版本已到 3 不再执行）。
//
// 注意：换表后 entities 已更名，INSERT/UPDATE 语句必须在换表完成后 prepare
// （SQLite 对 rename 前 prepare 的语句会报 SQLITE_SCHEMA，不会自动重解析）。

import type { Db } from "../connection.js";
import type { Migration } from "./index.js";
import { generateEntityId, generateId } from "@whispering233/ai-editor-shared";
import { nowIso } from "../storage/atomic.js";

/** v3 entities 表 DDL——列序与 schema.ts 的 CREATE_TABLES_SQL 一致（id/type/name/data/sort_order/created_at/updated_at/deleted_at） */
const ENTITIES_V3_DDL = `
CREATE TABLE entities_v3 (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event', 'timepoint')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  sort_order  INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
)
`;

export default {
  version: 3,
  up: (db: Db) => {
    // 1. 建新表（v3 结构：CHECK 含 timepoint）
    db.exec(ENTITIES_V3_DDL);
    // 2. 拷数据（全部列原样复制；time_label 仍在 event.data 内，随后按语义迁移）
    db.exec(
      `INSERT INTO entities_v3 (id, type, name, data, sort_order, created_at, updated_at, deleted_at)
       SELECT id, type, name, data, sort_order, created_at, updated_at, deleted_at FROM entities`,
    );
    // 3. 删旧表
    db.exec("DROP TABLE entities");
    // 4. 新表更名为 entities（此后才能 prepare 针对 entities 的语句）
    db.exec("ALTER TABLE entities_v3 RENAME TO entities");

    // 迁移时间戳：应用层 ISO 8601 统一写入（schema.md 时间约定，不用 SQLite datetime('now')）
    const now = nowIso();

    // 5. 数据迁移：time_label → timepoint + occurs_at（全部在 runMigrations 事务内）
    const events = db
      .prepare(
        `SELECT id, data FROM entities WHERE type = 'event' AND deleted_at IS NULL
         ORDER BY sort_order IS NULL, sort_order ASC, id ASC`,
      )
      .all() as Array<{ id: string; data: unknown }>;

    const insertTimepoint = db.prepare(
      `INSERT INTO entities (id, type, name, data, sort_order, created_at, updated_at)
       VALUES (?, 'timepoint', ?, '{}', ?, ?, ?)`,
    );
    const insertOccursAt = db.prepare(
      `INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at)
       VALUES (?, 'timepoint', ?, 'event', ?, 'occurs_at', ?, ?)`,
    );
    const updateEventData = db.prepare("UPDATE entities SET data = ?, updated_at = ? WHERE id = ?");

    /** trim 后标签 → 已建 timepoint（同名合并映射） */
    const timepointByLabel = new Map<string, string>();
    let nextOrder = 0;

    for (const event of events) {
      // data 坏行防御：非法 JSON / 非对象 → 跳过（不建关系、不改 data），其余事件不受影响
      let parsed: unknown = null;
      if (typeof event.data === "string") {
        try {
          parsed = JSON.parse(event.data);
        } catch {
          parsed = null;
        }
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      const label = record.time_label;
      // 非字符串 / trim 后为空 → 未挂载（等价旧「未标注时间」），不建关系、不改 data
      if (typeof label !== "string" || label.trim() === "") continue;
      const name = label.trim();

      let tpId = timepointByLabel.get(name);
      if (tpId === undefined) {
        // 同名合并：首个出现的组新建 timepoint（id 沿用 createEntity 的 generateEntityId 机制 → tp- 前缀）
        tpId = generateEntityId("timepoint");
        timepointByLabel.set(name, tpId);
        insertTimepoint.run(tpId, name, nextOrder, now, now);
        nextOrder += 1;
      }
      // occurs_at 挂载关系（id 沿用 db 关系生成机制 generateId("rel-")，与 createRelation 同款）
      insertOccursAt.run(generateId("rel-"), tpId, event.id, now, now);
      // 从 data 移除 time_label + 刷新 updated_at（迁移改写数据，版本戳刷新使旧提案快照失效）
      delete record.time_label;
      updateEventData.run(JSON.stringify(record), now, event.id);
    }
  },
} satisfies Migration;
