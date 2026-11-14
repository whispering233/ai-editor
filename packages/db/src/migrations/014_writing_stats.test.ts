// 迁移 014 测试（v13 → v14：新增 writing_stats_daily 码字日统计表，2026-11）
// 覆盖：空库路径（createTables）与迁移路径建出的表结构**逐项一致**（PRAGMA table_info +
// index_list）/ v13 旧库升级（表已建且可写、既有表数据完好）/ 幂等（重跑与手工回退版本重跑）/
// 全新空库短路路径不被破坏。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { ensureSchemaCompatible, runMigrations } from "../queries/migration.js";
import { readOutlineFile, writeOutlineFile } from "../storage/outline.js";

const T1 = "2026-11-01T10:00:00Z";

/** 014 建出的表列名与列序（DDL / CREATE_TABLES_SQL / docs/db/schema.md 逐字同形） */
const STATS_COLUMNS = ["stat_date", "chars", "updated_at"];

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
        updated_at: T1,
        children: [{ id: "ch-1", type: "chapter", title: "第一章", updated_at: T1, children: [] }],
      },
    ],
  };
}

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

function tableNames(d: Db): string[] {
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 造 v13 库：当前 DDL 库回退掉 014 新增的表（014 为纯 DDL，结构差异即新表）+ 存量数据 */
function createV13Db(path: string): Db {
  const d = openDatabase(path);
  d.exec("DROP TABLE IF EXISTS writing_stats_daily");
  d.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "char-1",
    "character",
    "旧角色",
    T1,
    T1,
  );
  d.prepare(
    "INSERT INTO document_records (owner_kind, owner_id, content, content_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("chapter", "ch-1", "[]", "", T1, T1);
  setUserVersion(d, 13);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-014-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath); // 空库路径：CREATE_TABLES_SQL 建出全部表（user_version = 0）
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("迁移 014（v13 → v14：码字日统计表）", () => {
  it("空库路径与迁移路径建出的表结构逐项一致（PRAGMA table_info + index_list 独立比对）", () => {
    const fresh = openDatabase(join(dir, "fresh.db"));
    const migratedPath = join(dir, "migrated.db");
    closeDatabase(db); // 本测试改用迁移路径的库（db 变量改指它，afterEach 关它）
    db = createV13Db(migratedPath);
    try {
      expect(tableNames(db)).not.toContain("writing_stats_daily"); // 前置：v13 结构无该表

      const { applied } = runMigrations(db, { dbPath: migratedPath });
      expect(applied.map((m) => m.version)).toEqual([14]);
      expect(getUserVersion(db)).toBe(SCHEMA_VERSION);

      expect(tableStructure(db, "writing_stats_daily")).toEqual(tableStructure(fresh, "writing_stats_daily"));
 // 快照本身不含糊（两条路径同错也拦得住）：列序如契约、主键 = stat_date、无索引
      expect(tableStructure(fresh, "writing_stats_daily").columns.map((c) => c.name)).toEqual(STATS_COLUMNS);
      expect(tableStructure(fresh, "writing_stats_daily").indexes).toEqual([]);
      expect(tableStructure(fresh, "writing_stats_daily").columns.find((c) => c.name === "stat_date")).toMatchObject({
        type: "TEXT",
        primaryKeyPosition: 1,
      });
      expect(tableStructure(fresh, "writing_stats_daily").columns.find((c) => c.name === "chars")).toMatchObject({
        type: "INTEGER",
        notNull: true,
      });
    } finally {
      closeDatabase(fresh);
    }
  });

  it("v13 存量库跑迁移：表已建且可写可读、既有表数据完好、重跑与回退版本重跑均幂等", () => {
    closeDatabase(db);
    db = createV13Db(dbPath);
    expect(getUserVersion(db)).toBe(13);

    runMigrations(db, { dbPath });
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
 // 既有表数据完好（纯 DDL 不重建、不搬移）
    expect((db.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM document_records").get() as { c: number }).c).toBe(1);
 // 旧项目没有历史统计：表为空（首次保存正文后才开始累计）
    expect((db.prepare("SELECT COUNT(*) AS c FROM writing_stats_daily").get() as { c: number }).c).toBe(0);

 // 迁移 DDL 建出的表可写可读（直插，不经 helper）
    db.prepare("INSERT INTO writing_stats_daily (stat_date, chars, updated_at) VALUES (?, ?, ?)").run(
      "2026-11-01",
      120,
      T1,
    );
    expect(db.prepare("SELECT chars FROM writing_stats_daily WHERE stat_date = ?").get("2026-11-01")).toEqual({
      chars: 120,
    });

    const afterFirst = tableStructure(db, "writing_stats_daily");
 // 幂等：版本已对齐 → 无 pending（不重放）；手工回退版本重跑 → 不报错且结构/行不变
    expect(runMigrations(db, { dbPath }).applied).toEqual([]);
    setUserVersion(db, 13);
    expect(() => runMigrations(db, { dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(tableStructure(db, "writing_stats_daily")).toEqual(afterFirst);
    expect(db.prepare("SELECT chars FROM writing_stats_daily WHERE stat_date = ?").get("2026-11-01")).toEqual({
      chars: 120,
    });
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
    expect(SCHEMA_VERSION).toBe(14);
    expect(readOutlineFile(dir)).toEqual(outlineBefore); // 大纲未被重置
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
 // 表已由建库路径就位（无需迁移参与）
    expect(tableStructure(active, "writing_stats_daily").columns.map((c) => c.name)).toEqual(STATS_COLUMNS);
  });
});