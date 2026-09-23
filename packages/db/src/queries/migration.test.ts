// S1.1 schema 演进删库重建测试
// 覆盖：版本匹配不重建 / 版本不匹配重建（备份+重置）/ 备份内容可读 / 旧版本号命名 / outline 缺失兜底
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema";
import migration009 from "../migrations/009_decompose.js";
import migration010 from "../migrations/010_decompose_concurrency.js";
import { OUTLINE_FILE_NAME, readOutlineFile, writeOutlineFile } from "../storage/outline";
import { DATA_DB_FILE_NAME, ensureSchemaCompatible, runMigrations, SchemaVersionError } from "./migration";

let dir: string;
let dbPath: string;
let db: Db;

/** 旧大纲树（重建前写入的「脏」内容） */
function oldTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: "2026-08-01T10:00:00Z",
        children: [
          { id: "ch-1", type: "chapter", title: "第一章", updated_at: "2026-08-01T10:00:00Z", children: [] },
        ],
      },
    ],
  };
}

/** 往 entities 表插入一行（构造「旧库有数据」） */
function insertOldEntity(d: Db, id: string): void {
  d.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    id, "character", "旧角色", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z",
  );
}

/** 查 entities 行数 */
function countEntities(d: Db): number {
  return (d.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c;
}

/** 业务表名清单（升序；sqlite_* 内部表排除） */
function tableNames(d: Db): string[] {
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 查 document_records 行数（迁移 008 建表验证） */
function countDocuments(d: Db): number {
  return (d.prepare("SELECT COUNT(*) AS c FROM document_records").get() as { c: number }).c;
}

/** 直插一行块文档（不走 helper：验证迁移建出的表列齐全、可写可读） */
function insertDocument(d: Db, ownerId: string): void {
  d.prepare(
    "INSERT INTO document_records (owner_kind, owner_id, content, content_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("chapter", ownerId, "[]", "", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-"));
  dbPath = join(dir, DATA_DB_FILE_NAME);
  db = openDatabase(dbPath); // 新库 user_version = 0
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("ensureSchemaCompatible 版本匹配", () => {
  it("user_version === SCHEMA_VERSION 时不触发重建，连接原样、数据保留", () => {
    setUserVersion(db, SCHEMA_VERSION);
    insertOldEntity(db, "char-1");
    writeOutlineFile(dir, oldTree());

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(false);
    expect(result.backups).toEqual([]);
    expect(active).toBe(db); // 同一连接，未关闭
    expect(countEntities(active)).toBe(1);
    expect(readOutlineFile(dir)).toEqual(oldTree());
  });
});

describe("ensureSchemaCompatible 版本不匹配 → 删库重建", () => {
  it("user_version=0 的旧库：重建后版本号正确、表空、outline 重置为空树、备份存在且旧连接已关闭", () => {
 // 旧库（user_version=0，新库默认）+ 脏数据
    insertOldEntity(db, "char-1");
    insertOldEntity(db, "char-2");
    writeOutlineFile(dir, oldTree());

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

 // 结果信息
    expect(result.rebuilt).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.toVersion).toBe(SCHEMA_VERSION);
 // 新库：版本号已写、表空（回收站天然为空，无需单独清空）
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(countEntities(active)).toBe(0);
 // outline.json 重置为最小空树（与 readOutlineFile 缺失语义同形）
    expect(readOutlineFile(dir)).toEqual({
      id: "root",
      type: "root",
      schema_version: SCHEMA_VERSION,
      children: [],
    });
 // 备份文件存在且已登记
    const dbBackup = join(dir, "data.db.v0.bak");
    const outlineBackup = join(dir, "outline.json.v0.bak");
    expect(existsSync(dbBackup)).toBe(true);
    expect(existsSync(outlineBackup)).toBe(true);
    expect(result.backups).toEqual([dbBackup, outlineBackup]);
 // 旧连接已被关闭（调用方应使用返回的新连接）
    expect(db.open).toBe(false);
    expect(active).not.toBe(db);
    closeDatabase(active);
  });

  it("备份文件内容可读：旧库数据在 data.db.v0.bak 中，旧大纲在 outline.json.v0.bak 中", () => {
    insertOldEntity(db, "char-1");
    writeOutlineFile(dir, oldTree());
    const outlineRawBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");

    const { db: active } = ensureSchemaCompatible(db, dir, dbPath);
    closeDatabase(active);

 // 打开备份库：旧数据行仍在（openDatabase 幂等建表，不影响读取）
    const backupDb = openDatabase(join(dir, "data.db.v0.bak"));
    expect(countEntities(backupDb)).toBe(1); // char-1
    closeDatabase(backupDb);
 // 备份的旧大纲字节与重建前一致（复制保留原始字节）
    expect(readFileSync(join(dir, "outline.json.v0.bak"), "utf8")).toBe(outlineRawBefore);
  });

  it("未来版本（user_version=SCHEMA_VERSION+1 > SCHEMA_VERSION）→ 拒绝打开：抛 SchemaVersionError、数据文件未动、无 .bak 备份（堵降级数据丢失）", () => {
 // 模拟「用户安装新版后回退旧版程序」：高版本库 + 数据 + 大纲
    setUserVersion(db, SCHEMA_VERSION + 1);
    insertOldEntity(db, "char-1");
    writeOutlineFile(dir, oldTree());
    const outlineRawBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");

    try {
      ensureSchemaCompatible(db, dir, dbPath);
      expect.unreachable("未来版本应拒绝打开");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionError);
      expect((err as SchemaVersionError).version).toBe(SCHEMA_VERSION + 1);
      expect((err as SchemaVersionError).current).toBe(SCHEMA_VERSION);
      expect((err as Error).message).toContain("高于当前程序版本");
    }
 // 拒绝分支：本次打开的连接已关闭（无句柄泄漏，afterEach 幂等）
    expect(db.open).toBe(false);
 // 数据原封不动：无 .bak 备份生成、data.db 主文件仍在且 user_version 仍为 4、
 // outline.json 字节原样、实体数据仍在（未触发任何重建/写操作）
    expect(existsSync(join(dir, "data.db.v5.bak"))).toBe(false);
    expect(existsSync(join(dir, "outline.json.v5.bak"))).toBe(false);
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineRawBefore);
    const reopened = openDatabase(dbPath);
    try {
      expect(getUserVersion(reopened)).toBe(SCHEMA_VERSION + 1);
      expect(countEntities(reopened)).toBe(1);
    } finally {
      closeDatabase(reopened);
    }
  });

  it("outline.json 缺失（异常状态）时重建仍成功：跳过备份但重置为空树", () => {
    insertOldEntity(db, "char-1");
 // 不写 outline.json

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(true);
 // 仅 data.db 备份，outline 备份跳过
    expect(result.backups).toEqual([join(dir, "data.db.v0.bak")]);
    expect(existsSync(join(dir, "outline.json.v0.bak"))).toBe(false);
 // outline.json 仍被重置
    expect(readOutlineFile(dir)).toEqual({
      id: "root",
      type: "root",
      schema_version: SCHEMA_VERSION,
      children: [],
    });
    closeDatabase(active);
  });
});

// ============ ensureSchemaCompatible 全新空库（卡 2.9：缺 data.db 的书） ============

describe("ensureSchemaCompatible 全新空库（缺 data.db）", () => {
  it("空库 + 表结构为当前 DDL → 只对齐版本号：outline.json 原样、无 .bak、连接原样", () => {
 // 缺 data.db 的书：openDatabase 就地建出空库（user_version=0），大纲有内容
    writeOutlineFile(dir, oldTree());
    const outlineRawBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(false);
    expect(result.migrated).toBeUndefined();
    expect(result.backups).toEqual([]);
    expect(active).toBe(db); // 连接原样（未关闭、未重建）
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
 // 大纲**未被重置**（旧逻辑会写成空树——卡 2.9 的修复点）
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineRawBefore);
    expect(readOutlineFile(dir)).toEqual(oldTree());
 // 无任何 .bak 产物（无数据可备）
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
  });

  it("当前 DDL 的空库但 version=0（结构对、无数据）→ 同样走对齐分支", () => {
    setUserVersion(db, 0);
    writeOutlineFile(dir, oldTree());

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(false);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(readOutlineFile(dir)).toEqual(oldTree());
  });

  it("空库但表结构不符（遗留 chat_messages 表）→ 仍走重建兜底：备份 + outline 重置", () => {
 // 模拟旧版库：当前 DDL 之外多一张遗留表（006 已 DROP），且无用户数据
    db.exec(
      "CREATE TABLE chat_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)",
    );
    writeOutlineFile(dir, oldTree());

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(result.backups).toEqual([join(dir, "data.db.v0.bak"), join(dir, "outline.json.v0.bak")]);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
 // 新库无遗留表
    const legacy = active.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'").get();
    expect(legacy).toBeUndefined();
 // outline 重置为空树（与既有重建语义一致）
    expect(readOutlineFile(dir)).toEqual({
      id: "root",
      type: "root",
      schema_version: SCHEMA_VERSION,
      children: [],
    });
    closeDatabase(active);
  });

  it("空库但 entities 表为旧 CHECK（4 类型）→ 仍走重建兜底", () => {
    db.exec("DROP TABLE entities");
    db.exec(
      `CREATE TABLE entities (
        id          TEXT PRIMARY KEY,
        type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook')),
        name        TEXT NOT NULL,
        data        TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      )`,
    );
    writeOutlineFile(dir, oldTree());

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(true);
 // 新库 CHECK 已回到当前 7 类型（写入 reference 类型成功）
    expect(() =>
      active
        .prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("ref-1", "reference", "资料", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
    ).not.toThrow();
    closeDatabase(active);
  });
});

describe("迁移 008（v7 → v8：document_records 块文档表）", () => {
  it("v7 库前向迁移：表已建且可写可读、既有表数据完好、重复执行幂等", () => {
 // 造 v7 库：当前 DDL 库回退掉 008 新增的表 + user_version=7（008 为纯 DDL，结构差异即新表）
    db.exec("DROP TABLE document_records");
    insertOldEntity(db, "char-1");
    setUserVersion(db, 7);

    const { applied } = runMigrations(db, { dbPath });
    expect(applied.map((m) => m.version)).toEqual([8, 9, 10, 11]); // v8 建块文档表 + v9/v10 拆解两表与并发列 + v11 移除两表（链到 SCHEMA_VERSION）
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(getUserVersion(db)).toBe(11);
 // 新表已建且可用（直插 + 计数，验证列齐全）
    insertDocument(db, "ch-1");
    expect(countDocuments(db)).toBe(1);
 // 既有表数据完好（纯 DDL 不重建、不搬移）
    expect(countEntities(db)).toBe(1);
 // 幂等（版本已对齐 → 无 pending、不再快照）
    const again = runMigrations(db, { dbPath });
    expect(again.applied).toEqual([]);
    expect(countDocuments(db)).toBe(1);
 // 手工回退版本重跑（异常重试路径）→ CREATE TABLE IF NOT EXISTS 不报错、旧行不丢
    setUserVersion(db, 7);
    expect(() => runMigrations(db, { dbPath })).not.toThrow();
    expect(countDocuments(db)).toBe(1);
    expect(countEntities(db)).toBe(1);
  });
});

describe("迁移 011（v10 → v11：移除拆解两表）", () => {
 /** 造 v10 存量库：注入历史迁移 009+010 建出两表与并发列（当前 DDL 已不含它们）+ 两表各一行存量数据 */
  function seedV10(db: Db): void {
    runMigrations(db, { migrations: [migration009, migration010], dbPath });
    expect(getUserVersion(db)).toBe(10);
    db.prepare(
      `INSERT INTO decompose_jobs (id, status, scope_start, scope_end, batch_target_chars, concurrency, model, merge_written, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("job-legacy", "paused", 1, 2, 12000, 4, null, null, null, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z");
    db.prepare("INSERT INTO decompose_batches (job_id, seq, chapter_ids, status, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      "job-legacy", 1, '["ch-1"]', "done", "2026-09-01T00:00:00Z",
    );
    insertOldEntity(db, "char-1");
  }

  it("v10 存量库前向迁移：两表被 DROP、user_version = 11、既有表数据完好、重复执行幂等", () => {
    seedV10(db);
    expect(tableNames(db)).toEqual(expect.arrayContaining(["decompose_jobs", "decompose_batches"])); // 前置：v10 结构确实有两表

    const { applied } = runMigrations(db, { dbPath });
    expect(applied.map((m) => m.version)).toEqual([11]); // 009/010 已由 seedV10 跑过
    expect(getUserVersion(db)).toBe(11);
    expect(tableNames(db)).not.toContain("decompose_jobs");
    expect(tableNames(db)).not.toContain("decompose_batches");
 // 既有表数据完好（纯 DDL 只 DROP 两表）
    expect(countEntities(db)).toBe(1);

 // 幂等：版本已对齐 → 无 pending；手工回退版本重跑 → DROP IF EXISTS 不报错
    const again = runMigrations(db, { dbPath });
    expect(again.applied).toEqual([]);
    setUserVersion(db, 10);
    expect(() => runMigrations(db, { dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(11);
    expect(countEntities(db)).toBe(1);
  });

  it("全新空库（createTables 路径）：两表不存在，删表迁移无对象可删", () => {
 // 新库只走 createTables（当前 DDL 已不含拆解两表）——结构即全新空库，对齐版本号不建任何表
    expect(tableNames(db)).toEqual(["delta_records", "document_records", "entities", "relation_records"]);
    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);
    expect(result.rebuilt).toBe(false);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(tableNames(active)).not.toContain("decompose_jobs");
    expect(tableNames(active)).not.toContain("decompose_batches");
  });
});

// ============ ensureSchemaCompatible 旧版本迁移路径（注入） ============

describe("ensureSchemaCompatible 旧版本有迁移路径", () => {
  it("user_version=0 + 注入迁移链（覆盖到 SCHEMA_VERSION）→ 前向迁移：数据保留、无重建备份、时间戳快照生成", () => {
    const migrations = [
      { version: 1, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN note TEXT") },
      { version: 2, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN extra TEXT") },
      { version: 3, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN third TEXT") },
      { version: 4, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN fourth TEXT") },
      { version: 5, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN fifth TEXT") },
      { version: 6, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN sixth TEXT") },
      { version: 7, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN seventh TEXT") },
      { version: 8, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN eighth TEXT") },
      { version: 9, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN ninth TEXT") },
      { version: 10, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN tenth TEXT") },
      { version: 11, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN eleventh TEXT") },
    ];
    insertOldEntity(db, "char-1");
    writeOutlineFile(dir, oldTree());
    const outlineRawBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath, { migrations });

 // 走迁移而非重建
    expect(result.rebuilt).toBe(false);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(0);
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
 // 数据保全：实体行仍在、outline 字节原样（重建会清空/重置）
    expect(countEntities(active)).toBe(1);
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineRawBefore);
 // 迁移副作用可见（note/extra/third 列已加）
    const cols = active.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "note")).toBe(true);
    expect(cols.some((c) => c.name === "extra")).toBe(true);
    expect(cols.some((c) => c.name === "third")).toBe(true);
    expect(cols.some((c) => c.name === "fourth")).toBe(true);
 // 无删库重建备份（data.db.v0.bak 不带时间戳的不生成）、有迁移时间戳快照
    expect(existsSync(join(dir, "data.db.v0.bak"))).toBe(false);
    expect(result.backups[0]).toMatch(/data\.db\.v0\.\d{8}T\d{6}\.\d{3}Z\.bak$/);
    closeDatabase(active);
  });

  it("user_version=0 + 默认迁移集（0→3 断链：无 v1 条目）→ 无迁移路径 → 重建兜底（前行为不变）", () => {
    insertOldEntity(db, "char-1");
    writeOutlineFile(dir, oldTree());

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(true);
    expect(result.migrated).toBeUndefined();
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    closeDatabase(active);
  });

  it("迁移中途失败（ora-3 S2）→ 连接已关闭（open 未生效，不留句柄）+ 版本停步 + 快照保留", () => {
 // 注入链覆盖到 SCHEMA_VERSION，v2 抛错——ensureSchemaCompatible 的
 // targetVersion=SCHEMA_VERSION，迁移链首个失败即可覆盖「runMigrations 中途抛错」路径
    const migrations = [
      { version: 1, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN note TEXT") },
      {
        version: 2,
        up: () => {
          throw new Error("migration boom");
        },
      },
      { version: 3, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN third TEXT") },
      { version: 4, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN fourth TEXT") },
      { version: 5, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN fifth TEXT") },
      { version: 6, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN sixth TEXT") },
      { version: 7, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN seventh TEXT") },
      { version: 8, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN eighth TEXT") },
      { version: 9, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN ninth TEXT") },
      { version: 10, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN tenth TEXT") },
      { version: 11, up: (d: Db) => d.exec("ALTER TABLE entities ADD COLUMN eleventh TEXT") },
    ];
    insertOldEntity(db, "char-1");

    expect(() => ensureSchemaCompatible(db, dir, dbPath, { migrations })).toThrow("migration boom");
 // 迁移失败 = open 未生效：本次打开的连接已关闭（与 拒绝分支同语义）
    expect(db.open).toBe(false);
 // 版本停步（v1 已提交，v2 未生效，仍为 1）、数据未动
    const reopened = openDatabase(dbPath);
    try {
      expect(getUserVersion(reopened)).toBe(1);
      expect(countEntities(reopened)).toBe(1);
    } finally {
      closeDatabase(reopened);
    }
 // 迁移前快照保留（重试现场）
    const snapFiles = readdirSync(dir).filter((f) => /^data\.db\.v0\.\d{8}T\d{6}\.\d{3}Z\.bak$/.test(f));
    expect(snapFiles.length).toBeGreaterThan(0);
  });
});
