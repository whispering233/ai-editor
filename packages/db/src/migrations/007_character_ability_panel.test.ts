// 007 迁移测试（角色旧 abilities[] → ability_panel，2026-09）
// 覆盖：标签迁为「能力」分组叶子 + 旧键移除 + updated_at 刷新 / 幂等（回退版本重跑无副作用）/
// 不覆盖已有面板 / 空数组与全空白标签只删键 / 非 character 不动 / 坏 JSON 与非对象 data 跳过 /
// 版本推进到 SCHEMA_VERSION
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { DATA_DB_FILE_NAME } from "../queries/migration.js";
import { runMigrations } from "../queries/migration.js";
import { MIGRATIONS } from "./index.js";

let dir: string;
let dbPath: string;
let db: Db;

/** 种子时间戳 */
const T0 = "2026-08-01T00:00:00Z";

interface EntitySeed {
  id: string;
  type: string;
  data: string;
}

function seedEntities(seeds: EntitySeed[]): void {
  const insert = db.prepare(
    "INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const s of seeds) {
    insert.run(s.id, s.type, s.id, s.data, T0, T0);
  }
}

/** 行 data 解析（坏 JSON → null，helper 防御） */
function dataOf(id: string): Record<string, unknown> | null {
  const row = db.prepare("SELECT data FROM entities WHERE id = ?").get(id) as { data: string };
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 行 updated_at */
function updatedAtOf(id: string): string {
  return (db.prepare("SELECT updated_at FROM entities WHERE id = ?").get(id) as { updated_at: string }).updated_at;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-mig-007-"));
  dbPath = join(dir, DATA_DB_FILE_NAME);
  db = openDatabase(dbPath); // 新库建当前结构（007 无 DDL——结构与 v6 一致）
  setUserVersion(db, 6); // 模拟 v6 旧库（待迁移）
  seedEntities([
    { id: "char-a", type: "character", data: JSON.stringify({ role: "主角", abilities: ["剑术", "炼丹"] }) },
    {
      id: "char-b",
      type: "character",
      data: JSON.stringify({ abilities: ["  剑术  ", "", 42, "炼丹"] }), // 去空白 + 丢非字符串/空串
    },
    {
      id: "char-c",
      type: "character",
      data: JSON.stringify({
        abilities: ["旧标签"],
        ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
      }), // 已有面板：不覆盖
    },
    { id: "char-d", type: "character", data: JSON.stringify({ abilities: [] }) }, // 空数组：只删键
    { id: "char-e", type: "character", data: JSON.stringify({ abilities: ["   "] }) }, // 全空白：只删键
    { id: "char-f", type: "character", data: "not-json" }, // 坏 JSON：跳过
    { id: "char-g", type: "character", data: "[]" }, // 非对象 data：跳过
    { id: "set-a", type: "setting", data: JSON.stringify({ abilities: ["同名残留"] }) }, // 非 character：不动
  ]);
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

/** 把「能力」分组下的叶子名取出来（断言用） */
function abilityLeafNames(id: string): string[] {
  const panel = dataOf(id)?.ability_panel;
  if (!Array.isArray(panel) || panel.length === 0) return [];
  const group = panel[0] as { name?: unknown; children?: unknown };
  if (!Array.isArray(group.children)) return [];
  return group.children.map((c) => String((c as { name?: unknown }).name));
}

describe("迁移 007（character 旧 abilities → ability_panel，2026-09）", () => {
  it("标签迁为「能力」分组叶子（value 留空）+ 旧键移除 + updated_at 刷新 + 版本推进到 SCHEMA_VERSION", () => {
    const { applied } = runMigrations(db, { migrations: MIGRATIONS, dbPath });

    expect(applied.map((m) => m.version)).toEqual([7]);
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(7);

    expect(dataOf("char-a")).toEqual({
      role: "主角",
      ability_panel: [{ name: "能力", children: [{ name: "剑术" }, { name: "炼丹" }] }],
    });
    expect(dataOf("char-a")?.abilities).toBeUndefined();
    expect(updatedAtOf("char-a")).not.toBe(T0);
  });

  it("标签去空白、丢弃非字符串与空串；顺序保持", () => {
    runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(abilityLeafNames("char-b")).toEqual(["剑术", "炼丹"]);
    expect(dataOf("char-b")?.abilities).toBeUndefined();
  });

  it("不覆盖已有面板：原面板不动、旧 abilities 作为残留保留", () => {
    runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(dataOf("char-c")).toEqual({
      abilities: ["旧标签"],
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
    });
    expect(updatedAtOf("char-c")).toBe(T0); // 未改写 → 版本戳不动
  });

  it("空数组 / 全空白标签 → 只删键不建面板", () => {
    runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(dataOf("char-d")).toEqual({});
    expect(dataOf("char-e")).toEqual({});
    expect(updatedAtOf("char-d")).not.toBe(T0); // 删键也算改写
  });

  it("坏 JSON / 非对象 data 跳过；非 character 类型的同名残留不动", () => {
    runMigrations(db, { migrations: MIGRATIONS, dbPath });
    expect(dataOf("char-f")).toBeNull(); // 坏 JSON 原样保留
    expect(dataOf("char-g")).toEqual([]); // 非对象 data 原样保留
    expect(dataOf("set-a")).toEqual({ abilities: ["同名残留"] });
    expect(updatedAtOf("set-a")).toBe(T0);
  });

  it("幂等：回退版本重跑不改写（叶子不重复、面板不重建）", () => {
    runMigrations(db, { migrations: MIGRATIONS, dbPath });
    const after = JSON.stringify(dataOf("char-a"));
    const stampAfter = updatedAtOf("char-a");

    setUserVersion(db, 6); // 模拟异常重试路径（版本回退后重跑）
    runMigrations(db, { migrations: MIGRATIONS, dbPath });

    expect(JSON.stringify(dataOf("char-a"))).toBe(after);
    expect(updatedAtOf("char-a")).toBe(stampAfter); // 无操作 → 不改写
    expect(abilityLeafNames("char-a")).toEqual(["剑术", "炼丹"]);
  });
});
