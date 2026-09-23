// 010 迁移测试（decompose_jobs 新增 concurrency 列：拆解并发段数快照，纯 DDL + 存量行回填）
// **历史迁移测试**（拆解功能已整功能移除，见 CHANGELOG；009/010 保留仅为旧库升级链连续）——
// 本文件只测 009/010 两步自身：当前 DDL 已不含两表，完整链的终点 011 会把它们 DROP。
// 覆盖：v9 库（decompose_jobs 缺 concurrency 列）跑 010——列建出且存量行回填 1、
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
import migration009 from "./009_decompose.js";
import migration010 from "./010_decompose_concurrency.js";

/** 只跑历史链路里的拆解两步（完整链 011 会把两表 DROP，本文件不覆盖那一步） */
const DECOMPOSE_STEPS = [migration009, migration010];

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
 * 造 v9 库：注入历史迁移 009 建出两表（当前 DDL 已不含它们，无 concurrency 列 = v9 形状）
 * + 补一行 job 与一行批（存量行 = 回填对象）+ user_version=9。
 */
function createV9Db(): Db {
  const d = openDatabase(dbPath);
  migration009.up(d, { projectRoot: dir });
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
  it("v9 库升级：列建出（列序与声明一致）且存量行回填 1、既有批行数据完好、版本推进到 v10", () => {
    db = createV9Db();
    expect(columnNames(db, "decompose_jobs")).not.toContain("concurrency"); // 前置：v9 结构确实缺列

    const { applied } = runMigrations(db, { migrations: DECOMPOSE_STEPS, dbPath });
    expect(applied.map((m) => m.version)).toEqual([10]); // 009 已由 createV9Db 跑过，010 在此推进
    expect(getUserVersion(db)).toBe(10);
    expect(SCHEMA_VERSION).toBe(11); // 当前版本号已越过两步（完整链终点 = 011 移除两表）

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
    runMigrations(db, { migrations: DECOMPOSE_STEPS, dbPath });

    // 版本已对齐：无 pending、不再执行
    const again = runMigrations(db, { migrations: DECOMPOSE_STEPS, dbPath });
    expect(again.applied).toEqual([]);
    expect(again.snapshot).toBeNull();

    // 手工回退版本号后重跑（异常重试路径）：列已在 ⇒ 跳过 ALTER（ALTER TABLE ADD COLUMN 无 IF NOT EXISTS）
    setUserVersion(db, 9);
    expect(() => runMigrations(db, { migrations: DECOMPOSE_STEPS, dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(10);
    expect(columnNames(db, "decompose_jobs").filter((name) => name === "concurrency")).toHaveLength(1);
    expect(db.prepare("SELECT concurrency FROM decompose_jobs WHERE id = ?").get("job-legacy")).toEqual({ concurrency: 1 });
  });

  it("全新空库短路：v0 + 当前 DDL（已无两表）→ 只对齐版本号，不重建、不备份、不碰 outline.json", () => {
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
    const legacy = active
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('decompose_jobs', 'decompose_batches')")
      .all() as Array<{ name: string }>;
    expect(legacy).toEqual([]); // 两表已随 011 从 DDL 移除（新库不建）
  });
});
