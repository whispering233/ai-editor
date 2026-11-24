// 迁移 015 测试（v14 → v15：新增 document_snapshots 章正文历史快照表 + owner 索引，2026-11）
// 覆盖：空库路径（createTables）与迁移路径建出的表结构**逐项一致**（PRAGMA table_info +
// index_list）/ v14 旧库升级（表已建且可写、既有表数据完好）/ `seq` 自增（同秒插入仍递增）/
// 幂等（重跑与手工回退版本重跑）/ 全新空库短路路径不被破坏。
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

/** 015 建出的表列名与列序（DDL / CREATE_TABLES_SQL / docs/db/schema.md 逐字同形） */
const SNAPSHOT_COLUMNS = ["seq", "owner_kind", "owner_id", "content", "char_count", "created_at"];

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

/** 造 v14 库：当前 DDL 库回退掉 015 新增的表（015 为纯 DDL，结构差异即新表）+ 存量数据 */
function createV14Db(path: string): Db {
  const d = openDatabase(path);
  d.exec("DROP TABLE IF EXISTS document_snapshots");
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
  setUserVersion(d, 14);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-015-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath); // 空库路径：CREATE_TABLES_SQL 建出全部表（user_version = 0）
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("迁移 015（v14 → v15：章正文历史快照表）", () => {
  it("空库路径与迁移路径建出的表结构逐项一致（PRAGMA table_info + index_list 独立比对）", () => {
    const fresh = openDatabase(join(dir, "fresh.db"));
    const migratedPath = join(dir, "migrated.db");
    closeDatabase(db); // 本测试改用迁移路径的库（db 变量改指它，afterEach 关它）
    db = createV14Db(migratedPath);
    try {
      expect(tableNames(db)).not.toContain("document_snapshots"); // 前置：v14 结构无该表

      const { applied } = runMigrations(db, { dbPath: migratedPath });
      expect(applied.map((m) => m.version)).toEqual([15]);
      expect(getUserVersion(db)).toBe(SCHEMA_VERSION);

      expect(tableStructure(db, "document_snapshots")).toEqual(tableStructure(fresh, "document_snapshots"));
 // 快照本身不含糊（两条路径同错也拦得住）：列序如契约、主键 = seq、owner 索引 = (owner_kind, owner_id, seq)
      expect(tableStructure(fresh, "document_snapshots").columns.map((c) => c.name)).toEqual(SNAPSHOT_COLUMNS);
      expect(tableStructure(fresh, "document_snapshots").columns.find((c) => c.name === "seq")).toMatchObject({
        type: "INTEGER",
        primaryKeyPosition: 1, // 自增主键（rowid 别名：PRAGMA 报 notnull=0，语义仍非空）
      });
      expect(tableStructure(fresh, "document_snapshots").indexes).toEqual([
        {
          name: "idx_document_snapshots_owner",
          unique: false,
          partial: false,
          columns: ["owner_kind", "owner_id", "seq"],
        },
      ]);
    } finally {
      closeDatabase(fresh);
    }
  });

  it("v14 存量库跑迁移：表已建且可写、seq 自增（同秒插入仍递增）、既有表数据完好、重跑幂等", () => {
    closeDatabase(db);
    db = createV14Db(dbPath);
    expect(getUserVersion(db)).toBe(14);

    runMigrations(db, { dbPath });
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
 // 既有表数据完好（纯 DDL 不重建、不搬移）
    expect((db.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM document_records").get() as { c: number }).c).toBe(1);
 // 旧项目没有历史快照：表为空（首次保存正文后才开始积累）
    expect((db.prepare("SELECT COUNT(*) AS c FROM document_snapshots").get() as { c: number }).c).toBe(0);

 // 迁移 DDL 建出的表可写可读，且 seq 自增（同 created_at 也严格递增——同秒多次保存的排序键）
    const insert = db.prepare(
      "INSERT INTO document_snapshots (owner_kind, owner_id, content, char_count, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    insert.run("chapter", "ch-1", "[]", 0, T1);
    insert.run("chapter", "ch-1", '[{"id":"b1"}]', 3, T1);
    const seqs = (db.prepare("SELECT seq FROM document_snapshots ORDER BY seq").all() as Array<{ seq: number }>).map(
      (r) => r.seq,
    );
    expect(seqs).toHaveLength(2);
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);

    const afterFirst = tableStructure(db, "document_snapshots");
 // 幂等：版本已对齐 → 无 pending（不重放）；手工回退版本重跑 → 不报错且结构/行不变
    expect(runMigrations(db, { dbPath }).applied).toEqual([]);
    setUserVersion(db, 14);
    expect(() => runMigrations(db, { dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(tableStructure(db, "document_snapshots")).toEqual(afterFirst);
    expect((db.prepare("SELECT COUNT(*) AS c FROM document_snapshots").get() as { c: number }).c).toBe(2);
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
    expect(SCHEMA_VERSION).toBe(15);
    expect(readOutlineFile(dir)).toEqual(outlineBefore); // 大纲未被重置
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
 // 表已由建库路径就位（无需迁移参与）
    expect(tableStructure(active, "document_snapshots").columns.map((c) => c.name)).toEqual(SNAPSHOT_COLUMNS);
  });
});