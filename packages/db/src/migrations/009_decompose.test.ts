// 009 迁移测试（拆解小说两表：decompose_jobs / decompose_batches，纯 DDL）
// 覆盖：v8 库（结构缺拆解两表）经迁移链升到 v9——两表建出且可写可读、既有表数据完好；
// 重复执行幂等（版本已对齐无 pending；手工回退版本重跑 CREATE IF NOT EXISTS 不报错、旧行不丢）；
// 全新空库短路（user_version=0 + 当前 DDL 空库 → 只对齐版本号，不重建、不备份、不碰 outline.json）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { ensureSchemaCompatible, runMigrations } from "../queries/migration.js";
import { OUTLINE_FILE_NAME, readOutlineFile, writeOutlineFile } from "../storage/outline.js";
import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { MIGRATIONS } from "./index.js";

const T1 = "2026-09-01T10:00:00Z";

let dir: string;
let dbPath: string;
let db: Db;

/** 脏大纲（短路分支「不碰 outline.json」的对照物） */
function dirtyTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 8,
    children: [
      { id: "vol-1", type: "volume", title: "第一卷", updated_at: T1, children: [] },
    ],
  };
}

/** 造 v8 库：当前 DDL 库回退掉 009 新增的两表（纯 DDL 迁移的结构差异即这两张表）+ user_version=8 */
function createV8Db(): Db {
  const d = openDatabase(dbPath);
  d.exec("DROP TABLE decompose_batches");
  d.exec("DROP TABLE decompose_jobs");
  d.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "char-1", "character", "旧角色", T1, T1,
  );
  setUserVersion(d, 8);
  return d;
}

/** 表列名（PRAGMA table_info，顺序 = DDL 列序） */
function columnNames(d: Db, table: string): string[] {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function tableNames(d: Db): string[] {
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 直插一行 job（不走 helper：验证迁移建出的表列齐全、可写可读） */
function insertJob(d: Db, id: string): void {
  d.prepare(
    `INSERT INTO decompose_jobs (id, status, scope_start, scope_end, batch_target_chars, model, merge_written, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, "running", 1, 3, 6000, "faux/model", null, null, T1, T1);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-m009-"));
  dbPath = join(dir, "data.db");
});

afterEach(() => {
  if (db !== undefined && db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("009_decompose 迁移（v8 → v9，拆解两表）", () => {
  it("v8 库升级：两表建出（列齐）且可写可读、既有表数据完好、版本推进到 SCHEMA_VERSION", () => {
    db = createV8Db();
    expect(tableNames(db)).not.toContain("decompose_jobs"); // 前置：v8 结构确实缺两表

    const { applied } = runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(applied.map((m) => m.version)).toEqual([9]); // 009 已聚合进 MIGRATIONS
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(9);

 // 两表列齐全（DDL 逐列核对，防漏列）
    expect(columnNames(db, "decompose_jobs")).toEqual([
      "id",
      "status",
      "scope_start",
      "scope_end",
      "batch_target_chars",
      "model",
      "merge_written",
      "error",
      "created_at",
      "updated_at",
    ]);
    expect(columnNames(db, "decompose_batches")).toEqual([
      "job_id",
      "seq",
      "chapter_ids",
      "status",
      "result",
      "attempts",
      "error",
      "updated_at",
    ]);

 // 可写可读 + attempts 默认 0（DDL 默认值生效）
    insertJob(db, "job-migrated");
    db.prepare(
      "INSERT INTO decompose_batches (job_id, seq, chapter_ids, status, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("job-migrated", 1, '["ch-1","ch-2"]', "pending", T1);
    const batch = db
      .prepare("SELECT chapter_ids, attempts, result, error FROM decompose_batches WHERE job_id = ? AND seq = ?")
      .get("job-migrated", 1) as Record<string, unknown>;
    expect(batch).toEqual({ chapter_ids: '["ch-1","ch-2"]', attempts: 0, result: null, error: null });

 // 既有表数据完好（纯 DDL 不重建、不搬移）
    const entities = db.prepare("SELECT id, name FROM entities").all() as Array<{ id: string; name: string }>;
    expect(entities).toEqual([{ id: "char-1", name: "旧角色" }]);
  });

  it("迁移幂等：版本已对齐 → 无 pending；手工回退版本重跑 → CREATE IF NOT EXISTS 不报错、旧行不丢", () => {
    db = createV8Db();
    runMigrations(db, { migrations: MIGRATIONS, dbPath });
    insertJob(db, "job-keep");

 // 版本已对齐：无 pending、不再执行
    const again = runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(again.applied).toEqual([]);
    expect(again.snapshot).toBeNull();

 // 手工回退版本号后重跑（异常重试路径）：不报错、既有 job 行保留
    setUserVersion(db, 8);
    expect(() => runMigrations(db, { migrations: MIGRATIONS, dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect((db.prepare("SELECT COUNT(*) AS c FROM decompose_jobs").get() as { c: number }).c).toBe(1);
  });

  it("全新空库短路：v0 + 当前 DDL（含拆解两表）→ 只对齐版本号，不重建、不备份、不碰 outline.json", () => {
    db = openDatabase(dbPath); // 缺 data.db 的书：就地建出当前 DDL 空库，user_version=0
    writeOutlineFile(dir, dirtyTree());
    const outlineRawBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(false);
    expect(result.migrated).toBeUndefined();
    expect(result.backups).toEqual([]);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineRawBefore);
    expect(readOutlineFile(dir)).toEqual(dirtyTree());
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]); // 无任何备份产物
    expect(tableNames(active)).toContain("decompose_batches"); // 两表本就存在（DDL 一致才判为全新空库）
  });
});
