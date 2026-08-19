// 002 迁移测试（决策 26 时间轴：entities CHECK 扩为 5 种 + sort_order 列；v1 库经全量迁移链
// 002→003 升到 v3——002 负责换表加 event/列，003 无事件可迁，只做同款换表加 timepoint）
// 覆盖：手工建 v1 结构库（旧 entities DDL）→ runMigrations(MIGRATIONS) →
// 数据保留（行数/列值）、CHECK 现含 event（且含 timepoint）、sort_order 列存在且旧行为 NULL
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Db } from "../connection.js";
import { closeDatabase } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { ensureSchemaCompatible, runMigrations } from "../queries/migration.js";
import { writeOutlineFile } from "../storage/outline.js";
import { MIGRATIONS } from "./index.js";

let dir: string;
let db: Db;

/** v1 的 entities 旧 DDL（与 v0.0.4 schema.ts CREATE_TABLES_SQL 一致：无 sort_order、CHECK 4 种） */
const ENTITIES_V1_DDL = `
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE TABLE relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
`;

/** 手工建 v1 结构库（绕过 openDatabase 的 v2 建表），user_version = 1 */
function createV1Db(): Db {
  const d = new Database(join(dir, "data.db"));
  d.exec(ENTITIES_V1_DDL);
  d.exec(
    `INSERT INTO entities (id, type, name, data, created_at, updated_at, deleted_at) VALUES
     ('char-1', 'character', '张三', '{"role":"主角"}', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', NULL),
     ('hook-1', 'hook', '身世之谜', '{}', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z'),
     ('set-1', 'setting', '修仙界', '{}', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', NULL)`,
  );
  d.exec(
    `INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES
     ('rel-1', 'character', 'char-1', 'outline_node', 'sc-1', 'appears_in', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
  );
  setUserVersion(d, 1);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-m002-"));
});

afterEach(() => {
  if (db !== undefined && db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("002_event_timeline 迁移（v1 → v2 → v3 全链路，决策 26 + G2）", () => {
  it("v1 库升级：数据保留（行数/列值）、CHECK 含 event 与 timepoint、sort_order 列存在且旧行为 NULL", () => {
    db = createV1Db();

    const { applied } = runMigrations(db, { migrations: MIGRATIONS });
    expect(applied.map((m) => m.version)).toEqual([2, 3, 4, 5]); // v1→v5 全链路（002→003→004→005）
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(5);

    // 数据保留：3 行实体 + 1 行关系（行数与列值原样；v1 库无事件 → 003 无 time_label 可迁）
    const entities = db
      .prepare("SELECT id, type, name, data, created_at, updated_at, deleted_at FROM entities ORDER BY id")
      .all() as Array<Record<string, unknown>>;
    expect(entities).toHaveLength(3);
    expect(entities[0]).toMatchObject({ id: "char-1", type: "character", name: "张三", data: '{"role":"主角"}' });
    expect(entities[1]).toMatchObject({ id: "hook-1", type: "hook", name: "身世之谜", deleted_at: "2026-08-02T00:00:00Z" });
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM relation_records").get() as { c: number }).c,
    ).toBe(1); // 关系表不受影响（003 无事件可迁，不建 occurs_at）

    // sort_order 列存在且旧行为 NULL（时间轴从空序起步）
    const cols = db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string; notnull: number }>;
    const sortCol = cols.find((c) => c.name === "sort_order");
    expect(sortCol).toBeDefined();
    expect(sortCol?.notnull).toBe(0);
    const nullOrders = db
      .prepare("SELECT COUNT(*) AS c FROM entities WHERE sort_order IS NULL")
      .get() as { c: number };
    expect(nullOrders.c).toBe(3);

    // CHECK 现含 event 与 timepoint：插入 event / timepoint 行成功（v1 结构下会被 CHECK 拒绝）
    expect(() =>
      db
        .prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, 'event', ?, ?, ?)")
        .run("ev-1", "藏经阁发现玉佩", "2026-08-03T00:00:00Z", "2026-08-03T00:00:00Z"),
    ).not.toThrow();
    expect(() =>
      db
        .prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, 'timepoint', ?, ?, ?)")
        .run("tp-1", "第二天黄昏", "2026-08-03T00:00:00Z", "2026-08-03T00:00:00Z"),
    ).not.toThrow();
  });

  it("迁移幂等：已到 v3 的库再跑 → 无 pending 不执行", () => {
    db = createV1Db();
    runMigrations(db, { migrations: MIGRATIONS });
    const { applied } = runMigrations(db, { migrations: MIGRATIONS });
    expect(applied).toEqual([]);
    expect(getUserVersion(db)).toBe(5);
  });

  it("v1 库经 ensureSchemaCompatible 完整链路迁移（含 outline.json 不动）", () => {
    db = createV1Db();
    const outline = { id: "root" as const, type: "root" as const, schema_version: 1, children: [] };
    writeOutlineFile(dir, outline);

    const { db: active, result } = ensureSchemaCompatible(db, join(dir), join(dir, "data.db"));
    db = active; // afterEach 关闭新连接
    expect(result.rebuilt).toBe(false);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(5);
    expect(getUserVersion(active)).toBe(5);
    expect(
      (active.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c,
    ).toBe(3); // 数据保全
    closeDatabase(active);
  });
});
