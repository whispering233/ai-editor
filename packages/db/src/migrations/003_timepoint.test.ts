// 003 迁移测试（G2 时间标签点实体化：event.data.time_label → timepoint + occurs_at）
// 覆盖：手工建 v2 结构库（CHECK 5 种 + sort_order）→ runMigrations(MIGRATIONS) →
// 同名合并 / 无标签不建关系 / 软删跳过 / data 移除 time_label + updated_at 刷新 /
// sort_order 按出现序 / 幂等（user_version = 3）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { runMigrations } from "../queries/migration.js";
import { MIGRATIONS } from "./index.js";

let dir: string;
let db: Db;

/** v2 的 entities DDL（与 002 迁移后结构一致：CHECK 5 种 + sort_order 列） */
const ENTITIES_V2_DDL = `
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('character', 'setting', 'location', 'hook', 'event')),
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
`;

/** 种子时间戳（迁移时间必然晚于它——nowIso 为真实当前时间） */
const T0 = "2026-08-01T00:00:00Z";

/** 事件行种子：id / 标签 / sort_order / 是否软删 / data 原文 */
interface EventSeed {
  id: string;
  label: string | null;
  sortOrder: number | null;
  deleted?: boolean;
  extraData?: string;
}

/** 手工建 v2 结构库（绕过 openDatabase 的 v3 建表），user_version = 2 */
function createV2Db(events: EventSeed[]): Db {
  const d = new Database(join(dir, "data.db"));
  d.exec(ENTITIES_V2_DDL);
  for (const e of events) {
    const data = e.extraData ?? (e.label === null ? "{}" : JSON.stringify({ time_label: e.label }));
    d.prepare(
      `INSERT INTO entities (id, type, name, data, sort_order, created_at, updated_at, deleted_at)
       VALUES (?, 'event', ?, ?, ?, ?, ?, ?)`,
    ).run(e.id, e.id, data, e.sortOrder, T0, T0, e.deleted === true ? "2026-08-02T00:00:00Z" : null);
  }
  // 非 event 实体（data 含 time_label 也不应被迁移触碰）
  d.prepare(
    `INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, 'character', ?, ?, ?, ?)`,
  ).run("char-1", "张三", '{"time_label":"不应迁移"}', T0, T0);
  setUserVersion(d, 2);
  return d;
}

/** 读 entities 行（原始列值） */
function rawRow(d: Db, id: string): Record<string, unknown> {
  return d.prepare("SELECT * FROM entities WHERE id = ?").get(id) as Record<string, unknown>;
}

/** 查 occurs_at 关系（未软删） */
function occursAtRows(d: Db): Array<Record<string, unknown>> {
  return d
    .prepare(
      `SELECT * FROM relation_records WHERE relation_type = 'occurs_at' AND deleted_at IS NULL ORDER BY target_id`,
    )
    .all() as Array<Record<string, unknown>>;
}

/** 全部 timepoint 行（按 sort_order） */
function timepointRows(d: Db): Array<Record<string, unknown>> {
  return d
    .prepare(`SELECT * FROM entities WHERE type = 'timepoint' ORDER BY sort_order`)
    .all() as Array<Record<string, unknown>>;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-m003-"));
});

afterEach(() => {
  if (db !== undefined && db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("003_timepoint 迁移（v2 → v3，G2 时间标签点实体化）", () => {
  it("同名合并 + 无标签不建关系 + 软删跳过 + data 移除 time_label + sort_order 按出现序", () => {
    db = createV2Db([
      // 列表序（sort_order 升序、NULL 沉底、id 稳定）：ev-5(0) → ev-1(1) → ev-3(2) → ev-2(3)
      // 首现序 → timepoint sort_order：第三天=0（ev-5 首个出现）、第二天黄昏=1（ev-1 首个出现）
      { id: "ev-1", label: "第二天黄昏", sortOrder: 1, extraData: '{"description":"藏经阁发现玉佩","time_label":"第二天黄昏","tags":["主线"]}' },
      { id: "ev-2", label: "第二天黄昏", sortOrder: 3 },
      { id: "ev-3", label: null, sortOrder: 2, extraData: '{"description":"无标签事件"}' },
      { id: "ev-4", label: "第三纪元", sortOrder: null, deleted: true },
      { id: "ev-5", label: "  第三天  ", sortOrder: 0 }, // 前后空白 → trim 后为「第三天」
      { id: "ev-6", label: "   ", sortOrder: null }, // 纯空白 → 视为无标签
    ]);

    const { applied } = runMigrations(db, { migrations: MIGRATIONS });
    expect(applied.map((m) => m.version)).toEqual([3]); // v2 → v3 只跑 003
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(3);

    // ---- timepoint：同名合并为 1 个，sort_order 按各组首个事件出现序 0..n-1 ----
    const tps = timepointRows(db);
    expect(tps).toHaveLength(2);
    expect(tps[0]).toMatchObject({ type: "timepoint", name: "第三天", data: "{}", sort_order: 0, deleted_at: null });
    expect(tps[1]).toMatchObject({ type: "timepoint", name: "第二天黄昏", data: "{}", sort_order: 1, deleted_at: null });
    for (const tp of tps) {
      expect(String(tp.id)).toMatch(/^tp-/); // 沿用 generateEntityId 机制（tp- 前缀）
      expect(Date.parse(String(tp.created_at))).toBeGreaterThan(Date.parse(T0)); // 迁移时间戳
      expect(tp.created_at).toBe(tp.updated_at);
    }

    // ---- occurs_at：带标签未软删事件各一条，指向合并后的 timepoint ----
    const rels = occursAtRows(db);
    expect(rels).toHaveLength(3);
    const relByTarget = new Map(rels.map((r) => [r.target_id, r]));
    const tpByName = new Map(tps.map((tp) => [tp.name, tp.id]));
    const r1 = relByTarget.get("ev-1")!;
    expect(r1).toMatchObject({
      source_type: "timepoint",
      source_id: tpByName.get("第二天黄昏"),
      target_type: "event",
      target_id: "ev-1",
      relation_type: "occurs_at",
      deleted_at: null,
    });
    expect(String(r1.id)).toMatch(/^rel-/); // 沿用 db 关系 id 生成机制
    expect(r1.source_id).toBe(relByTarget.get("ev-2")!.source_id); // 同名合并 → 同一 timepoint
    expect(relByTarget.get("ev-5")!.source_id).toBe(tpByName.get("第三天"));
    // 无标签 / 纯空白 / 软删事件不建关系
    expect(relByTarget.has("ev-3")).toBe(false);
    expect(relByTarget.has("ev-6")).toBe(false);
    expect(relByTarget.has("ev-4")).toBe(false);

    // ---- event.data：time_label 移除 + updated_at 刷新（仅被迁移的事件）----
    const ev1 = rawRow(db, "ev-1");
    expect(JSON.parse(String(ev1.data))).toEqual({ description: "藏经阁发现玉佩", tags: ["主线"] }); // time_label 已移除，其余字段保留
    expect(ev1.updated_at).toBe(tps[0].updated_at); // 迁移时间戳统一
    expect(Date.parse(String(ev1.updated_at))).toBeGreaterThan(Date.parse(T0));
    expect(JSON.parse(String(rawRow(db, "ev-2").data))).toEqual({});
    expect(JSON.parse(String(rawRow(db, "ev-5").data))).toEqual({});

    // ---- 无标签事件：不建关系、data 原样（字节级）、updated_at 不变 ----
    expect(rawRow(db, "ev-3")).toMatchObject({ data: '{"description":"无标签事件"}', updated_at: T0 });
    // 纯空白标签事件同样原样保留（含 time_label 键——按无标签处理）
    expect(rawRow(db, "ev-6")).toMatchObject({ data: '{"time_label":"   "}', updated_at: T0 });

    // ---- 软删事件完全跳过：data 原样（time_label 保留）、无 timepoint/关系 ----
    const ev4 = rawRow(db, "ev-4");
    expect(ev4).toMatchObject({ deleted_at: "2026-08-02T00:00:00Z", data: '{"time_label":"第三纪元"}', updated_at: T0 });
    expect(db.prepare("SELECT id FROM entities WHERE name = '第三纪元'").get()).toBeUndefined();

    // ---- 非 event 实体不受影响 ----
    expect(rawRow(db, "char-1")).toMatchObject({ data: '{"time_label":"不应迁移"}', updated_at: T0 });
  });

  it("无任何带标签事件时：零 timepoint、零 occurs_at、数据原样", () => {
    db = createV2Db([
      { id: "ev-1", label: null, sortOrder: 0, extraData: '{"description":"仅此一件"}' },
      { id: "ev-2", label: null, sortOrder: 1, deleted: true }, // 软删 + 无标签
    ]);

    const { applied } = runMigrations(db, { migrations: MIGRATIONS });
    expect(applied.map((m) => m.version)).toEqual([3]); // v2 → v3 只跑 003
    expect(getUserVersion(db)).toBe(3);
    expect(timepointRows(db)).toHaveLength(0);
    expect(occursAtRows(db)).toHaveLength(0);
    expect(rawRow(db, "ev-1")).toMatchObject({ data: '{"description":"仅此一件"}', updated_at: T0 });
  });

  it("坏行防御：data 为非法 JSON 的事件跳过（不建关系、不改 data）", () => {
    db = createV2Db([]);
    // 预插一条 data 为非法 JSON 的 event（手改库/异常写入）
    db.prepare(
      `INSERT INTO entities (id, type, name, data, sort_order, created_at, updated_at) VALUES (?, 'event', ?, ?, ?, ?, ?)`,
    ).run("ev-bad", "坏行", "{ 这不是 JSON", 0, T0, T0);

    runMigrations(db, { migrations: MIGRATIONS });
    expect(timepointRows(db)).toHaveLength(0);
    expect(occursAtRows(db)).toHaveLength(0);
    expect(rawRow(db, "ev-bad")).toMatchObject({ data: "{ 这不是 JSON", updated_at: T0 }); // 原样保留
  });

  it("幂等：迁移后 user_version = 3，重跑无 pending", () => {
    db = createV2Db([{ id: "ev-1", label: "第二天黄昏", sortOrder: 0 }]);
    runMigrations(db, { migrations: MIGRATIONS });
    expect(getUserVersion(db)).toBe(3);
    const { applied } = runMigrations(db, { migrations: MIGRATIONS });
    expect(applied).toEqual([]);
    expect(getUserVersion(db)).toBe(3);
    // 数据不被二次处理（timepoint 仍只有 1 个、关系仍 1 条）
    expect(timepointRows(db)).toHaveLength(1);
    expect(occursAtRows(db)).toHaveLength(1);
  });
});
