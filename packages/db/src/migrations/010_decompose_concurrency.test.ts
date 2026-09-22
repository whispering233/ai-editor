// 010 迁移测试（decompose_jobs 新增 concurrency 列：拆解并发段数快照，纯 DDL + 存量行回填）
// 覆盖：v9 库（decompose_jobs 缺 concurrency 列）经迁移链升到 v10——列建出且存量行回填 1、
// 既有批行数据完好；重复执行幂等（版本已对齐无 pending；手工回退版本重跑不撞 duplicate column）；
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
    schema_version: 9,
    children: [
      { id: "vol-1", type: "volume", title: "第一卷", updated_at: T1, children: [] },
    ],
  };
}

/** 表列名（PRAGMA table_info，顺序 = DDL 列序） */
function columnNames(d: Db, table: string): string[] {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/**
 * 造 v9 库：当前 DDL 库删掉 010 新增的 concurrency 列（纯 DDL 迁移的结构差异即这一列）
 * + 补一行 job 与一行批（存量行 = 回填对象）+ user_version=9。
 * SQLite ≥ 3.35 支持 DROP COLUMN（本仓 better-sqlite3 实测 3.53）。
 */
function createV9Db(): Db {
  const d = openDatabase(dbPath);
  d.exec("ALTER TABLE decompose_jobs DROP COLUMN concurrency");
  d.prepare(
    `INSERT INTO decompose_jobs (id, status, scope_start, scope_end, batch_target_chars, model, merge_written, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("job-legacy", "done", 1, 2, 12000, "faux/model", null, null, T1, T1);
  d.prepare(
    "INSERT INTO decompose_batches (job_id, seq, chapter_ids, status, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("job-legacy", 1, '["ch-1","ch-2"]', "done", T1);
  setUserVersion(d, 9);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-m010-"));
  dbPath = join(dir, "data.db");
});

afterEach(() => {
  if (db !== undefined && db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("010_decompose_concurrency 迁移（v9 → v10，decompose_jobs.concurrency）", () => {
  it("v9 库升级：列建出（列序与声明一致）且存量行回填 1、既有批行数据完好、版本推进到 SCHEMA_VERSION", () => {
    db = createV9Db();
    expect(columnNames(db, "decompose_jobs")).not.toContain("concurrency"); // 前置：v9 结构确实缺列

    const { applied } = runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(applied.map((m) => m.version)).toEqual([10]); // 010 已聚合进 MIGRATIONS
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(10);

    // 列序 = ALTER 追加在表末（新库 DDL 把该列放在 batch_target_chars 之后——顺序对查询无语义，
    // 两处都按列名访问；类型 / NOT NULL 一致由 schema.test.ts 的声明层断言锁住）
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
      "concurrency",
    ]);
    // 存量行回填 1（历史 job 本就是串行）——不是 NULL、不是别的缺省
    expect(db.prepare("SELECT concurrency FROM decompose_jobs WHERE id = ?").get("job-legacy")).toEqual({ concurrency: 1 });
    // 新行可显式写入
    db.prepare(
      `INSERT INTO decompose_jobs (id, status, scope_start, scope_end, batch_target_chars, concurrency, model, merge_written, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("job-new", "pending", 1, 2, 12000, 4, null, null, null, T1, T1);
    expect(db.prepare("SELECT concurrency FROM decompose_jobs WHERE id = ?").get("job-new")).toEqual({ concurrency: 4 });
    // 既有批行数据完好（纯 DDL 不重建、不搬移）
    expect(db.prepare("SELECT chapter_ids, status FROM decompose_batches WHERE job_id = ? AND seq = ?").get("job-legacy", 1)).toEqual({
      chapter_ids: '["ch-1","ch-2"]',
      status: "done",
    });
  });

  it("迁移幂等：版本已对齐 → 无 pending；手工回退版本重跑 → 不撞 duplicate column、旧行不丢", () => {
    db = createV9Db();
    runMigrations(db, { migrations: MIGRATIONS, dbPath });

    // 版本已对齐：无 pending、不再执行
    const again = runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(again.applied).toEqual([]);
    expect(again.snapshot).toBeNull();

    // 手工回退版本号后重跑（异常重试路径）：列已在 ⇒ 跳过 ALTER（ALTER TABLE ADD COLUMN 无 IF NOT EXISTS）
    setUserVersion(db, 9);
    expect(() => runMigrations(db, { migrations: MIGRATIONS, dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(columnNames(db, "decompose_jobs").filter((name) => name === "concurrency")).toHaveLength(1);
    expect(db.prepare("SELECT concurrency FROM decompose_jobs WHERE id = ?").get("job-legacy")).toEqual({ concurrency: 1 });
  });

  it("全新空库短路：v0 + 当前 DDL（含 concurrency 列）→ 只对齐版本号，不重建、不备份、不碰 outline.json", () => {
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
    expect(columnNames(active, "decompose_jobs")).toContain("concurrency"); // 当前 DDL 本就含该列
  });
});
