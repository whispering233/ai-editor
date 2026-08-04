// E5 增量迁移机制测试：runMigrations（顺序执行/失败回滚/快照）+ hasMigrationPath + snapshotDbFile
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { hasMigrationPath, runMigrations, snapshotDbFile } from "../queries/migration.js";
import type { Migration } from "./index.js";

let dir: string;
let dbPath: string;
let db: Db;

/** 注入用假迁移链：v1 加列 → v2 填值 → v3 插行（连续链 0→1→2→3） */
const fakeMigrations: Migration[] = [
  { version: 1, up: (d) => d.exec("ALTER TABLE entities ADD COLUMN note TEXT") },
  {
    version: 2,
    up: (d) => d.prepare("UPDATE entities SET note = 'migrated'").run(),
  },
  {
    version: 3,
    up: (d) =>
      d
        .prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("char-m3", "character", "迁移角色", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z"),
  },
];

/** 造一行实体（供迁移副作用验证） */
function seedEntity(d: Db, id = "char-1"): void {
  d.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    id, "character", "旧角色", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z",
  );
}

function countEntities(d: Db): number {
  return (d.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migrate-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath); // 新库 user_version = 0（旧版本，模拟待迁移库）
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("runMigrations（E5 前向迁移）", () => {
  it("连续迁移链顺序执行：每步 setUserVersion、全部完成后版本对齐、副作用逐级可见", () => {
    seedEntity(db);
    setUserVersion(db, 0); // 显式旧版本（新库默认 0，此处冗余但语义清晰）

    const { applied, snapshot } = runMigrations(db, {
      migrations: fakeMigrations,
      targetVersion: 3,
      dbPath,
    });

    // 执行顺序 = version 升序（v1 → v2 → v3）
    expect(applied.map((m) => m.version)).toEqual([1, 2, 3]);
    expect(getUserVersion(db)).toBe(3); // 对齐 targetVersion
    // 副作用逐级可见：v1 加列 → v2 填值 → v3 插行
    const cols = db.prepare("PRAGMA table_info(entities)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "note")).toBe(true);
    const row = db.prepare("SELECT note FROM entities WHERE id = ?").get("char-1") as { note: string };
    expect(row.note).toBe("migrated");
    expect(countEntities(db)).toBe(2); // char-1 + char-m3
    // 迁移前快照已生成（带时间戳命名）
    expect(snapshot).toMatch(/data\.db\.v0\.\d{8}T\d{6}\.\d{3}Z\.bak$/);
    expect(existsSync(snapshot!)).toBe(true);
    // 快照内容 = 迁移前状态（user_version=0、实体 1 行）
    const snapDb = openDatabase(snapshot!);
    try {
      expect(getUserVersion(snapDb)).toBe(0);
      expect(countEntities(snapDb)).toBe(1);
    } finally {
      closeDatabase(snapDb);
    }
  });

  it("版本已对齐时无 pending → 不执行不快照（幂等）", () => {
    setUserVersion(db, SCHEMA_VERSION);
    const { applied, snapshot } = runMigrations(db, { migrations: fakeMigrations, dbPath });
    expect(applied).toEqual([]);
    expect(snapshot).toBeNull();
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
  });

  it("targetVersion 以下的条目不执行（只迁移到目标版本）", () => {
    seedEntity(db);
    const { applied } = runMigrations(db, { migrations: fakeMigrations, targetVersion: 2, dbPath });
    expect(applied.map((m) => m.version)).toEqual([1, 2]);
    expect(getUserVersion(db)).toBe(2);
    expect(countEntities(db)).toBe(1); // v3 未执行
  });
});

describe("runMigrations 失败回滚（E5 原子性）", () => {
  it("某迁移抛错 → 该迁移事务整体回滚（副作用与版本号均不落）、后续不执行、快照保留", () => {
    seedEntity(db);
    const failing: Migration[] = [
      { version: 1, up: (d) => d.exec("ALTER TABLE entities ADD COLUMN note TEXT") },
      {
        version: 2,
        up: (d) => {
          d.prepare("UPDATE entities SET note = 'boom'").run();
          throw new Error("migration boom");
        },
      },
      { version: 3, up: (d) => seedEntity(d, "char-m3") },
    ];

    expect(() => runMigrations(db, { migrations: failing, targetVersion: 3, dbPath })).toThrow("migration boom");
    // 版本停在前一迁移后（v1 已提交，v2 未生效）
    expect(getUserVersion(db)).toBe(1);
    // v2 副作用回滚：note 列存在（v1 提交）但值未写（v2 UPDATE 回滚）
    const row = db.prepare("SELECT note FROM entities WHERE id = ?").get("char-1") as { note: string | null };
    expect(row.note).toBeNull();
    // v3 未执行
    expect(countEntities(db)).toBe(1);
    // 迁移前快照保留（重试现场）：data.db.v0.{时间戳}.bak 存在（函数抛错返回值拿不到，扫目录确认）
    const snapFiles = readdirSync(dir).filter((f) => /^data\.db\.v0\.\d{8}T\d{6}\.\d{3}Z\.bak$/.test(f));
    expect(snapFiles.length).toBeGreaterThan(0);
  });

  it("失败后重跑：从当前版本续跑（版本停在哪就从哪继续）", () => {
    seedEntity(db);
    const flaky: Migration[] = [
      { version: 1, up: (d) => d.exec("ALTER TABLE entities ADD COLUMN note TEXT") },
      {
        version: 2,
        up: (d) => {
          d.prepare("UPDATE entities SET note = 'migrated'").run();
        },
      },
    ];
    // 第一次：v2 抛错（模拟瞬时失败）
    const boom: Migration[] = [
      flaky[0],
      {
        version: 2,
        up: (d) => {
          d.prepare("UPDATE entities SET note = 'boom'").run();
          throw new Error("boom");
        },
      },
    ];
    expect(() => runMigrations(db, { migrations: boom, targetVersion: 2, dbPath })).toThrow("boom");
    expect(getUserVersion(db)).toBe(1);
    // 第二次：正常迁移链 → 从 v2 续跑
    const { applied } = runMigrations(db, { migrations: flaky, targetVersion: 2, dbPath });
    expect(applied.map((m) => m.version)).toEqual([2]);
    expect(getUserVersion(db)).toBe(2);
    const row = db.prepare("SELECT note FROM entities WHERE id = ?").get("char-1") as { note: string };
    expect(row.note).toBe("migrated");
  });
});

describe("hasMigrationPath（E5 纯函数）", () => {
  it("连续链 true / 断链 false / 空迁移 false / 目标已达成 true", () => {
    expect(hasMigrationPath(0, 3, fakeMigrations)).toBe(true); // v1,v2,v3 连续
    expect(hasMigrationPath(1, 3, fakeMigrations)).toBe(true); // v2,v3
    expect(hasMigrationPath(0, 2, [fakeMigrations[0], fakeMigrations[2]])).toBe(false); // v2 缺失（断链）
    expect(hasMigrationPath(0, 1, [])).toBe(false); // 无迁移
    expect(hasMigrationPath(0, 2, [])).toBe(false);
    expect(hasMigrationPath(3, 3, fakeMigrations)).toBe(true); // 已达成无需路径
  });

  it("超出 targetVersion 的条目不影响路径判定", () => {
    const withExtra = [...fakeMigrations, { version: 5, up: () => {} }];
    expect(hasMigrationPath(0, 3, withExtra)).toBe(true);
  });
});

describe("snapshotDbFile（E5 时间戳快照）", () => {
  it("命名含版本号与毫秒时间戳；快照文件保留", () => {
    seedEntity(db);
    const snap1 = snapshotDbFile(dbPath, 0);
    expect(snap1).toMatch(/data\.db\.v0\.\d{8}T\d{6}\.\d{3}Z\.bak$/);
    expect(existsSync(snap1)).toBe(true);
    // 毫秒时间戳区分重试快照（同毫秒内两次调用可能同名——内容相同，覆盖无害；
    // 真实重试间隔远大于 1ms）
  });
});
