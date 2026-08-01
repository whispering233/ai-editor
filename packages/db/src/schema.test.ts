// T2.1 建表与 schema 版本管理测试
// 临时目录建库，断言表结构 / 索引 / CHECK 约束 / user_version 读写往返
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase, closeDatabase, type Db } from "./connection.js";
import { createTables, getUserVersion, SCHEMA_VERSION, setUserVersion } from "./schema.js";

let dir: string;
let dbPath: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-schema-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

/** 查 sqlite_master 中的业务表名集合 */
function listTables(d: Db): string[] {
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 查 PRAGMA index_list 中由 CREATE INDEX 语句创建的索引（排除 PRIMARY KEY 的 sqlite_autoindex_*） */
function listIndexes(d: Db, table: string): Array<{ name: string; partial: number; origin: string }> {
  const rows = d.pragma(`index_list(${table})`) as Array<{ name: string; partial: number; origin: string }>;
  return rows.filter((i) => i.origin === "c");
}

/** 断言某操作抛出指定错误码的 SQLite 约束错误（better-sqlite3 错误码在 error.code，不在 message） */
function expectConstraintError(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛出 ${code} 错误`);
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
  }
}

describe("schema.ts 建表", () => {
  it("打开后自动创建 4 张业务表", () => {
    expect(listTables(db).sort()).toEqual(
      ["chat_messages", "delta_records", "entities", "relation_records"].sort(),
    );
  });

  it("relation_records 有 3 个部分索引（WHERE deleted_at IS NULL，决策 12 修订）", () => {
    const indexes = listIndexes(db, "relation_records");
    const names = indexes.map((i) => i.name).sort();
    expect(names).toEqual(["idx_relation_source", "idx_relation_target", "idx_relation_type"].sort());
    // 全部为部分索引（partial=1）
    for (const idx of indexes) {
      expect(idx.partial).toBe(1);
    }
  });

  it("chat_messages 有会话索引 (session_id, created_at)，且非部分索引", () => {
    const indexes = listIndexes(db, "chat_messages");
    const sessionIdx = indexes.find((i) => i.name === "idx_chat_session");
    expect(sessionIdx).toBeDefined();
    expect(sessionIdx?.partial).toBe(0);
  });

  it("createTables 幂等：重复执行不报错、不重复建表", () => {
    expect(() => createTables(db)).not.toThrow();
    expect(listTables(db)).toHaveLength(4);
  });

  it("entities.type CHECK 约束生效：非法 type 插入报错，合法 type 可插入", () => {
    const insert = db.prepare(
      "INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );
    // 非法 type：SQLITE_CONSTRAINT_CHECK
    expectConstraintError(
      () => insert.run("char-1", "invalid", "测试", "2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z"),
      "SQLITE_CONSTRAINT_CHECK",
    );
    // 合法 type：四类均可插入
    for (const type of ["character", "setting", "location", "hook"]) {
      expect(() => insert.run(`e-${type}`, type, "测试", "2026-08-01T10:00:00Z", "2026-08-01T10:00:00Z")).not.toThrow();
    }
  });

  it("chat_messages.role CHECK 约束生效：非法 role 插入报错", () => {
    const insert = db.prepare(
      "INSERT INTO chat_messages (id, session_id, project_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    expectConstraintError(
      () => insert.run("m-1", "sess-1", "proj-1", "system", "2026-08-01T10:00:00Z"),
      "SQLITE_CONSTRAINT_CHECK",
    );
    for (const role of ["user", "assistant", "tool"]) {
      expect(() => insert.run(`m-${role}`, "sess-1", "proj-1", role, "2026-08-01T10:00:00Z")).not.toThrow();
    }
  });

  it("user_version 读写往返（决策 13：MVP 版本号取 1）", () => {
    // 新库默认 0
    expect(getUserVersion(db)).toBe(0);
    setUserVersion(db, SCHEMA_VERSION);
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("setUserVersion 拒绝非整数版本号（防模板拼接注入面）", () => {
    // 非整数：1.5 / NaN / 字符串数字均拒绝
    expect(() => setUserVersion(db, 1.5)).toThrow(/必须是整数/);
    expect(() => setUserVersion(db, Number.NaN)).toThrow(/必须是整数/);
    // 整数正常写入
    expect(() => setUserVersion(db, 2)).not.toThrow();
    expect(getUserVersion(db)).toBe(2);
  });
});
