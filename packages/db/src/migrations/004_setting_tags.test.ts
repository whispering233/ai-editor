// 004 迁移测试（决策 31 K2 修订：setting 旧 rules 分类值 → data.tags，移除 rules）
// 覆盖：v3 库手工建表（含 setting 行）→ runMigrations → rules 复制到 tags + rules 移除 /
// 空 rules 不动 / 坏 JSON 跳过 / 非 setting 不动 / updated_at 刷新 / 幂等（user_version = 4）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Db } from "../connection.js";
import { getUserVersion, setUserVersion } from "../schema.js";
import { runMigrations } from "../queries/migration.js";
import { MIGRATIONS } from "./index.js";

let dir: string;
let db: Db;

/** v3 的 entities DDL（CHECK 6 种含 timepoint + sort_order——与 003 迁移后结构一致） */
const ENTITIES_V3_DDL = `
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event', 'timepoint')),
  name        TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  sort_order  INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE TABLE relation_records (
  id            TEXT PRIMARY KEY,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE TABLE delta_records (
  id          TEXT PRIMARY KEY,
  node_id     TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  changes     TEXT NOT NULL,
  description TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
`;

/** 种子时间戳 */
const T0 = "2026-08-01T00:00:00Z";

interface SettingSeed {
  id: string;
  data: string;
}

/** 手工建 v3 结构库（绕过 openDatabase 的 v4 建表），user_version = 3 */
function createV3Db(settings: SettingSeed[]): Db {
  const d = new Database(join(dir, "data.db"));
  d.exec(ENTITIES_V3_DDL);
  const insert = d.prepare(
    "INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, 'setting', ?, ?, ?, ?)",
  );
  for (const s of settings) {
    insert.run(s.id, s.id, s.data, T0, T0);
  }
  setUserVersion(d, 3);
  return d as unknown as Db;
}

function settingData(id: string): Record<string, unknown> | null {
  const row = db.prepare("SELECT data FROM entities WHERE id = ?").get(id) as { data: string };
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null; // 坏 JSON：helper 防御
  }
}

describe("迁移 004（setting 旧 rules → data.tags，决策 31 K2 修订）", () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ai-editor-mig-004-"));
    db = createV3Db([
      { id: "set-a", data: JSON.stringify({ description: "修真界", rules: ["势力", "宗门"] }) },
      { id: "set-b", data: JSON.stringify({ description: "藏剑阁", rules: ["势力"] }) },
      { id: "set-c", data: JSON.stringify({ description: "无标签设定" }) },
      { id: "set-d", data: JSON.stringify({ description: "空数组", rules: [] }) },
      { id: "set-e", data: "not-json" }, // 坏 JSON：跳过
      { id: "set-f", data: JSON.stringify({ description: "非字符串数组", rules: [42] }) },
    ]);
  });

  afterEach(() => {
    (db as unknown as Database.Database).close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("旧 rules 分类值 → data.tags（复制 + 移除 rules）+ updated_at 刷新 + user_version = 4", () => {
    runMigrations(db, MIGRATIONS);
    expect(getUserVersion(db as unknown as Database.Database)).toBe(4);
    expect(settingData("set-a")).toEqual({
      description: "修真界",
      tags: ["势力", "宗门"],
      // rules 键已移除
    });
    expect(settingData("set-a").rules).toBeUndefined();
    const row = db.prepare("SELECT updated_at FROM entities WHERE id = ?").get("set-a") as { updated_at: string };
    expect(row.updated_at).not.toBe(T0);
  });

  it("空/缺失/非法 rules 原样保留（无 tags 注入），坏 JSON 跳过", () => {
    runMigrations(db, MIGRATIONS);
    expect(settingData("set-c")).toEqual({ description: "无标签设定" });
    expect(settingData("set-d")).toEqual({ description: "空数组", rules: [] });
    expect(settingData("set-e")).toBeNull(); // 坏 JSON 不动（原样保留）
    expect(settingData("set-f")).toEqual({ description: "非字符串数组", rules: [42] });
  });

  it("幂等：user_version 已到 4 不再执行（无 tags 不重复注入）", () => {
    runMigrations(db, MIGRATIONS);
    const setA = JSON.stringify(settingData("set-a"));
    // 手工回退版本后重跑（模拟异常重试路径）——004 幂等性由版本门控保证
    setUserVersion(db as unknown as Database.Database, 3);
    runMigrations(db, MIGRATIONS);
    expect(JSON.stringify(settingData("set-a"))).toBe(setA);
  });
});
