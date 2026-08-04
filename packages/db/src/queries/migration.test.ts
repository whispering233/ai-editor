// S1.1 schema 演进删库重建测试（决策 13）
// 覆盖：版本匹配不重建 / 版本不匹配重建（备份+重置）/ 备份内容可读 / 旧版本号命名 / outline 缺失兜底
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import { closeDatabase, openDatabase, type Db } from "../connection";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema";
import { OUTLINE_FILE_NAME, readOutlineFile, writeOutlineFile } from "../storage/outline";
import { DATA_DB_FILE_NAME, ensureSchemaCompatible, SchemaVersionError } from "./migration";

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

describe("ensureSchemaCompatible 版本不匹配 → 删库重建（决策 13）", () => {
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
    // 新库：版本号已写、表空（回收站天然为空，决策 13 无需单独清空）
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

  it("未来版本（user_version=2 > SCHEMA_VERSION）→ 拒绝打开：抛 SchemaVersionError、数据文件未动、无 .bak 备份（E4 堵降级数据丢失）", () => {
    // 模拟「用户安装新版后回退旧版程序」：高版本库 + 数据 + 大纲
    setUserVersion(db, 2);
    insertOldEntity(db, "char-1");
    writeOutlineFile(dir, oldTree());
    const outlineRawBefore = readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8");

    try {
      ensureSchemaCompatible(db, dir, dbPath);
      expect.unreachable("未来版本应拒绝打开");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionError);
      expect((err as SchemaVersionError).version).toBe(2);
      expect((err as SchemaVersionError).current).toBe(SCHEMA_VERSION);
      expect((err as Error).message).toContain("高于当前程序版本");
    }
    // 拒绝分支：本次打开的连接已关闭（无句柄泄漏，afterEach 幂等）
    expect(db.open).toBe(false);
    // 数据原封不动：无 .bak 备份生成、data.db 主文件仍在且 user_version 仍为 2、
    // outline.json 字节原样、实体数据仍在（未触发任何重建/写操作）
    expect(existsSync(join(dir, "data.db.v2.bak"))).toBe(false);
    expect(existsSync(join(dir, "outline.json.v2.bak"))).toBe(false);
    expect(readFileSync(join(dir, OUTLINE_FILE_NAME), "utf8")).toBe(outlineRawBefore);
    const reopened = openDatabase(dbPath);
    try {
      expect(getUserVersion(reopened)).toBe(2);
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
