// 卡 2 迁移 012 测试（v11 → v12：练习两表 practice_targets / practice_samples，2026-10）
// **历史迁移测试**（练习模型已在 013 重建：旧两表被 DROP、换为三张新表）——本文件只测 012 自身：
// 当前 DDL 已不含旧两表，故 v11 库 = 当前 DDL 库回退掉练习三表 + `user_version = 11`。
// 覆盖：v11 库跑 012——两表建出（列齐）且可写可读；重复执行幂等（版本已对齐无 pending；
// 手工回退版本重跑 CREATE IF NOT EXISTS 不报错、旧行不丢）；旧行形态与 013 的拆除目标一致
// （012 不再建 `idx_practice_samples_target`：它只会与 013 后的重跑冲突，见 012 头注释）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { runMigrations } from "../queries/migration.js";
import migration012 from "./012_practice.js";

/** 旧两表（012 建出、013 拆除）；也是 v11 → v12 的唯一结构差量 */
const LEGACY_TABLES = ["practice_targets", "practice_samples"] as const;

let dir: string;
let dbPath: string;
let db: Db;

/** 表列名（PRAGMA table_info，顺序 = DDL 列序）；表不存在 = 空数组 */
function columnNames(d: Db, table: string): string[] {
  const rows = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function indexNames(d: Db, table: string): string[] {
  const rows = d.pragma(`index_list(${table})`) as Array<{ name: string; origin: string }>;
  return rows.filter((i) => i.origin === "c").map((i) => i.name);
}

function countSampleRows(d: Db): number {
  return (d.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c;
}

/** 回退练习三表（每表一条字面量语句，无拼接）：旧两表本就不在当前 DDL 里，剩余结构即 v11 库 */
function dropPracticeTables(d: Db): void {
  d.exec("DROP TABLE IF EXISTS practice_samples");
  d.exec("DROP TABLE IF EXISTS practice_free_pieces");
  d.exec("DROP TABLE IF EXISTS practice_style_packs");
}

/**
 * 造 v11 库：当前 DDL 库 DROP 掉练习三表 + `user_version = 11`。
 */
function createV11Db(path: string): Db {
  const d = openDatabase(path);
  dropPracticeTables(d);
  setUserVersion(d, 11);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-012-"));
  dbPath = join(dir, "data.db");
});

afterEach(() => {
  if (db !== undefined && db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("迁移 012（v11 → v12：练习两表）", () => {
  it("v11 库跑 012：两表按旧形状建出且可写可读、版本推进到 12；SCHEMA_VERSION 已越到 13", () => {
    db = createV11Db(dbPath);
    for (const table of LEGACY_TABLES) {
      expect(columnNames(db, table), `${table} 迁移前应不存在`).toEqual([]);
    }

    const { applied } = runMigrations(db, { migrations: [migration012], dbPath });
    expect(applied.map((m) => m.version)).toEqual([12]);
    expect(getUserVersion(db)).toBe(12);
    expect(SCHEMA_VERSION).toBe(13); // 当前版本已越过 012（练习模型重建）

 // 旧形状逐列核对（013 的拆除目标即它们）
    expect(columnNames(db, "practice_targets")).toEqual(["id", "name", "observation", "created_at", "updated_at"]);
    expect(columnNames(db, "practice_samples")).toEqual([
      "id",
      "target_id",
      "source_kind",
      "source_label",
      "text",
      "draft",
      "feedback",
      "created_at",
      "updated_at",
    ]);
    expect(indexNames(db, "practice_samples")).toEqual([]); // 索引已不再由 012 建（见头注释）

 // 可写可读（直插，不经 helper）
    db.prepare(
      "INSERT INTO practice_targets (id, name, observation, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("pt-legacy", "汪曾祺", null, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
    db.prepare(
      `INSERT INTO practice_samples (id, target_id, source_kind, source_label, text, draft, feedback, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "ps-legacy",
      "pt-legacy",
      "paste",
      "受戒节选",
      "明海出家已经四年了。",
      "",
      null,
      "2026-10-01T00:00:00Z",
      "2026-10-01T00:00:00Z",
    );
    expect(countSampleRows(db)).toBe(1);

 // 幂等：版本已对齐 → 无 pending；手工回退版本重跑 → CREATE IF NOT EXISTS 不报错、行不丢
    expect(runMigrations(db, { migrations: [migration012], dbPath }).applied).toEqual([]);
    setUserVersion(db, 11);
    expect(() => runMigrations(db, { migrations: [migration012], dbPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(12);
    expect(countSampleRows(db)).toBe(1);
  });
});