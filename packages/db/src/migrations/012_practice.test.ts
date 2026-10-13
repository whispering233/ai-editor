// 卡 2 迁移 012 测试（v11 → v12：练习两表 practice_targets / practice_samples，2026-10）
// 覆盖：空库路径（createTables）与迁移路径建出的两表结构**逐项一致**（PRAGMA table_info +
// index_list + index_info 独立比对）/ 迁移幂等（重跑不报错、结构不变）/ 全新空库短路路径不被破坏 /
// 迁移 DDL 建出的表可写可读（列齐全）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { ensureSchemaCompatible, runMigrations } from "../queries/migration.js";
import { readOutlineFile, writeOutlineFile } from "../storage/outline.js";

/** 012 新增的两张练习表（v12 相对 v11 的唯一结构差量） */
const PRACTICE_TABLES = ["practice_targets", "practice_samples"] as const;

/** 表结构快照（独立比对用，不经 drizzle 声明层） */
interface TableStructure {
  columns: Array<{
    name: string;
    type: string;
    notNull: boolean;
    defaultValue: string | null;
    primaryKeyPosition: number;
  }>;
  indexes: Array<{ name: string; unique: boolean; partial: boolean; columns: string[] }>;
}

let dir: string;
let dbPath: string;
let db: Db;

/** 有内容的旧大纲树（验证空库短路路径不重置它） */
function dirtyTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: "2026-10-01T00:00:00Z",
        children: [{ id: "ch-1", type: "chapter", title: "第一章", updated_at: "2026-10-01T00:00:00Z", children: [] }],
      },
    ],
  };
}

/**
 * 表结构快照（独立比对用）：
 * - `table_info`：列序 + 列名 + 声明类型 + NOT NULL + 缺省值 + 主键位次
 * - `index_list`/`index_info`：非内部索引（origin='c'）的唯一/部分标志 + 覆盖列与列序
 */
function tableStructure(d: Db, table: string): TableStructure {
  const columns = (d.pragma(`table_info(${table})`) as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>).map((c) => ({
    name: c.name,
    type: c.type,
    notNull: c.notnull === 1,
    defaultValue: c.dflt_value,
    primaryKeyPosition: c.pk,
  }));
  const indexes = (d.pragma(`index_list(${table})`) as Array<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>)
    .filter((i) => i.origin === "c")
    .map((i) => ({
      name: i.name,
      unique: i.unique === 1,
      partial: i.partial === 1,
      columns: (d.pragma(`index_info(${i.name})`) as Array<{ seqno: number; name: string }>)
        .sort((a, b) => a.seqno - b.seqno)
        .map((c) => c.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { columns, indexes };
}

/**
 * 造 v11 库：当前 DDL 建库后 **DROP 掉 012 新增的两表**（v12 相对 v11 的唯一结构差量）
 * + `user_version = 11`——即真实 v11 库的结构（当时这两张表还不存在）。
 */
function createV11Db(path: string): Db {
  const d = openDatabase(path);
  d.exec("DROP TABLE practice_samples; DROP TABLE practice_targets;");
  setUserVersion(d, 11);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-012-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath); // 空库路径：CREATE_TABLES_SQL 建出全部表（user_version = 0）
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("迁移 012（v11 → v12：练习两表）", () => {
  it("空库路径与迁移路径建出的两表结构逐项一致（PRAGMA table_info + index_list + index_info 独立比对）", () => {
 // 空库路径：openDatabase → CREATE_TABLES_SQL（before 的 db）
    const fresh = openDatabase(join(dir, "fresh.db"));
 // 迁移路径：v11 库跑 runMigrations（012 建两表）
    const migratedPath = join(dir, "migrated.db");
    const migrated = createV11Db(migratedPath);
    try {
      for (const table of PRACTICE_TABLES) {
        expect(tableStructure(migrated, table).columns, `${table} 迁移前应不存在`).toEqual([]);
      }
      const { applied } = runMigrations(migrated, { dbPath: migratedPath });
      expect(applied.map((m) => m.version)).toEqual([12]);
      expect(getUserVersion(migrated)).toBe(12);

 // 逐表逐项比对两条路径的结构快照（列/类型/NOT NULL/缺省/主键 + 索引名/唯一/部分/覆盖列）
      for (const table of PRACTICE_TABLES) {
        expect(tableStructure(migrated, table), `${table} 两条路径结构不一致`).toEqual(tableStructure(fresh, table));
      }

 // 快照本身不含糊（两条路径同错也拦得住）：索引落在目标列、列清单与主键/draft 缺省值如契约
      const samples = tableStructure(fresh, "practice_samples");
      expect(samples.indexes).toEqual([
        { name: "idx_practice_samples_target", unique: false, partial: false, columns: ["target_id"] },
      ]);
      expect(samples.columns.map((c) => c.name)).toEqual([
        "id",
        "target_id",
        "source_kind",
        "source_label",
        "text",
        "draft",
        "feedback",
        "created_at",
        "updated_at",
      ]);
      expect(samples.columns.find((c) => c.name === "draft")).toMatchObject({
        notNull: true,
        defaultValue: "''",
        primaryKeyPosition: 0,
      });
      expect(samples.columns.find((c) => c.name === "id")?.primaryKeyPosition).toBe(1);
      expect(tableStructure(fresh, "practice_targets").columns.map((c) => c.name)).toEqual([
        "id",
        "name",
        "observation",
        "created_at",
        "updated_at",
      ]);
    } finally {
      closeDatabase(migrated);
      closeDatabase(fresh);
    }
  });

  it("v11 库跑迁移：user_version 11 → 12、两表落库且可写可读（列齐全）；重跑不报错、结构不变", () => {
    closeDatabase(db); // 本测试用迁移路径的库
    const migratedPath = join(dir, "v11.db");
    db = createV11Db(migratedPath);
    expect(getUserVersion(db)).toBe(11);
    for (const table of PRACTICE_TABLES) {
      expect(tableStructure(db, table).columns).toEqual([]);
    }

    runMigrations(db, { dbPath: migratedPath });
    expect(getUserVersion(db)).toBe(12);
    const afterFirst = PRACTICE_TABLES.map((table) => tableStructure(db, table));

 // 迁移 DDL 建出的表列齐全、可写可读（直插，不经 helper）
    db.prepare(
      "INSERT INTO practice_targets (id, name, observation, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("pt-legacy", "汪曾祺", null, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
    db.prepare(
      `INSERT INTO practice_samples (id, target_id, source_kind, source_label, text, draft, feedback, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "ps-legacy",
      "pt-legacy",
      "paste",
      "受戒节选",
      "明海出家已经四年了。",
      "",
      null,
      "2026-10-01T00:00:00Z",
      "2026-10-01T00:00:00Z",
    );
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_targets").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c).toBe(1);

 // 幂等：版本已对齐 → 无 pending；手工回退版本重跑 → CREATE IF NOT EXISTS 不报错、结构不变、行不丢
    expect(runMigrations(db, { dbPath: migratedPath }).applied).toEqual([]);
    setUserVersion(db, 11);
    expect(() => runMigrations(db, { dbPath: migratedPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(12);
    expect(PRACTICE_TABLES.map((table) => tableStructure(db, table))).toEqual(afterFirst);
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c).toBe(1);
  });

  it("全新空库短路（user_version=0 且结构 = 当前 DDL）不被本迁移破坏：只对齐版本号、不备份、不碰 outline.json", () => {
    writeOutlineFile(dir, dirtyTree());
    const outlineBefore = readOutlineFile(dir);

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(false);
    expect(result.migrated).toBeUndefined();
    expect(result.backups).toEqual([]);
    expect(active).toBe(db); // 连接原样（未重建）
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(12);
    expect(readOutlineFile(dir)).toEqual(outlineBefore); // 大纲未被重置
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
 // 两表已由建库路径就位（无需迁移参与）
    for (const table of PRACTICE_TABLES) {
      expect(tableStructure(active, table).columns.length).toBeGreaterThan(0);
    }
  });
});
