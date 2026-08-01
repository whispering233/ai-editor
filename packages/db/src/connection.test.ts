// T2.1 连接与事务测试
// 断言 WAL 模式、自动建表、事务提交/回滚（含嵌套 SAVEPOINT）、user_version 跨重连持久性、关闭与临时文件清理
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, withTransaction, type Db } from "./connection.js";
import { getUserVersion, setUserVersion } from "./schema.js";

let dir: string;
let dbPath: string;
let db: Db;

/** 插入一条实体（id 唯一） */
function insertEntity(id: string): void {
  db.prepare(
    "INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, 'character', '测试', '2026-08-01T10:00:00Z', '2026-08-01T10:00:00Z')",
  ).run(id);
}

/** 统计 entities 行数 */
function countEntities(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM entities").get() as { n: number }).n;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-conn-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("connection.ts openDatabase", () => {
  it("在指定路径创建 data.db 文件", () => {
    expect(existsSync(dbPath)).toBe(true);
  });

  it("WAL 模式 + synchronous=FULL（data-flow.md 第 51 行：写入即时落盘）", () => {
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    // PRAGMA synchronous: 0=OFF 1=NORMAL 2=FULL
    expect(db.pragma("synchronous", { simple: true })).toBe(2);
  });

  it("打开后自动建表（4 张业务表已存在）", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name).sort()).toEqual(
      ["chat_messages", "delta_records", "entities", "relation_records"].sort(),
    );
  });
});

describe("connection.ts withTransaction", () => {
  it("事务内语句正常提交，返回值透传", () => {
    const result = withTransaction(db, () => {
      insertEntity("char-1");
      return countEntities();
    });
    expect(result).toBe(1);
    // 提交后数据落盘可见
    expect(countEntities()).toBe(1);
  });

  it("事务内抛错则整体回滚，数据不落盘", () => {
    expect(() =>
      withTransaction(db, () => {
        insertEntity("char-1");
        insertEntity("char-2");
        throw new Error("模拟事务中途失败");
      }),
    ).toThrow("模拟事务中途失败");
    // 回滚后两条插入均不可见
    expect(countEntities()).toBe(0);
    // 连接仍可用（事务已干净回滚）
    expect(db.prepare("SELECT 1 AS ok").get()).toEqual({ ok: 1 });
  });

  it("嵌套事务：内层正常提交，外层提交后两层数据均落盘（SAVEPOINT 语义）", () => {
    withTransaction(db, () => {
      insertEntity("char-1");
      withTransaction(db, () => {
        insertEntity("char-2");
      });
    });
    expect(countEntities()).toBe(2);
  });

  it("嵌套事务：内层抛错回滚到 SAVEPOINT，外层捕获后仍可继续并提交", () => {
    withTransaction(db, () => {
      insertEntity("char-1");
      // 内层失败：回滚到 SAVEPOINT，char-2 不落盘
      expect(() =>
        withTransaction(db, () => {
          insertEntity("char-2");
          throw new Error("内层失败");
        }),
      ).toThrow("内层失败");
      // 外层捕获后继续插入并正常提交
      insertEntity("char-3");
    });
    expect(countEntities()).toBe(2); // char-1 + char-3，内层 char-2 已回滚
  });
});

describe("connection.ts closeDatabase", () => {
  it("关闭后 open 标志为 false，且幂等可重复关闭", () => {
    expect(db.open).toBe(true);
    closeDatabase(db);
    expect(db.open).toBe(false);
    expect(() => closeDatabase(db)).not.toThrow();
  });
});

describe("connection.ts user_version 持久性", () => {
  it("setUserVersion 后关闭重开同一路径，版本保留", () => {
    setUserVersion(db, 1);
    closeDatabase(db);
    const reopened = openDatabase(dbPath);
    try {
      expect(getUserVersion(reopened)).toBe(1);
    } finally {
      closeDatabase(reopened);
    }
  });
});
