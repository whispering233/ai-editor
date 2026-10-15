// 卡 2 迁移 013 测试（v12 → v13：作家文风练习模型重建，2026-10）
// 覆盖：空库路径（createTables）与迁移路径建出的三表结构**逐项一致**（PRAGMA table_info +
// index_list + index_info 独立比对）/ v12 旧两表与旧索引被 DROP、旧行随表消失、既有表数据完好 /
// 迁移幂等（重跑与手工回退版本重跑均不报错、结构不变）/ 全新空库短路路径不被破坏。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { getUserVersion, SCHEMA_VERSION, setUserVersion } from "../schema.js";
import { ensureSchemaCompatible, runMigrations } from "../queries/migration.js";
import { readOutlineFile, writeOutlineFile } from "../storage/outline.js";
import migration012 from "./012_practice.js";

/** 013 建出的三张练习表 */
const PRACTICE_TABLES = ["practice_samples", "practice_free_pieces", "practice_style_packs"] as const;

/** v12 的旧两表（013 拆除目标） */
const LEGACY_TABLES = ["practice_targets", "practice_samples"] as const;

/** v12 的旧索引（013 的 `DROP INDEX IF EXISTS` 目标） */
const LEGACY_SAMPLE_INDEX = "idx_practice_samples_target";

/** 013 建出的三表列名与列序（DDL / CREATE_TABLES_SQL / docs/db/schema.md 逐字同形） */
const PRACTICE_COLUMNS: Record<(typeof PRACTICE_TABLES)[number], string[]> = {
  practice_samples: ["id", "work_id", "excerpt_label", "text", "draft", "feedback", "created_at", "updated_at"],
  practice_free_pieces: ["id", "topic", "brief", "topic_source", "draft", "feedback", "created_at", "updated_at"],
  practice_style_packs: ["author_id", "content", "updated_at"],
};

const T1 = "2026-10-01T00:00:00Z";

/** 表结构快照（独立比对用，不经 drizzle 声明层） */
interface TableStructure {
  columns: Array<{
    name: string;
    type: string;
    notNull: boolean;
    defaultValue: string | null;
    primaryKeyPosition: number;
  }>;
  indexes: Array<{ name: string; unique: boolean; partial: boolean; columns: string[] }>;
}

let dir: string;
let dbPath: string;
let db: Db;

/** 有内容的旧大纲树（验证空库短路路径不重置它） */
function dirtyTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: T1,
        children: [{ id: "ch-1", type: "chapter", title: "第一章", updated_at: T1, children: [] }],
      },
    ],
  };
}

/**
 * 表结构快照（独立比对用）：
 * - `table_info`：列序 + 列名 + 声明类型 + NOT NULL + 缺省值 + 主键位次
 * - `index_list`/`index_info`：非内部索引（origin='c'）的唯一/部分标志 + 覆盖列与列序
 */
function tableStructure(d: Db, table: string): TableStructure {
  const columns = (d.pragma(`table_info(${table})`) as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>).map((c) => ({
    name: c.name,
    type: c.type,
    notNull: c.notnull === 1,
    defaultValue: c.dflt_value,
    primaryKeyPosition: c.pk,
  }));
  const indexes = (d.pragma(`index_list(${table})`) as Array<{
    name: string;
    unique: number;
    origin: string;
    partial: number;
  }>)
    .filter((i) => i.origin === "c")
    .map((i) => ({
      name: i.name,
      unique: i.unique === 1,
      partial: i.partial === 1,
      columns: (d.pragma(`index_info(${i.name})`) as Array<{ seqno: number; name: string }>)
        .sort((a, b) => a.seqno - b.seqno)
        .map((c) => c.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { columns, indexes };
}

/** 某表上的非内部索引名（013 前后比对旧索引用） */
function practiceSampleIndexNames(d: Db): string[] {
  return tableStructure(d, "practice_samples").indexes.map((i) => i.name);
}

function tableNames(d: Db): string[] {
  const rows = d
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/** 回退练习三表（每表一条字面量语句，无拼接）＋ 版本回到 11，再用 012 补出 v12 的旧两表结构 */
function createV12Db(path: string): Db {
  const d = openDatabase(path);
  d.exec("DROP TABLE IF EXISTS practice_samples");
  d.exec("DROP TABLE IF EXISTS practice_free_pieces");
  d.exec("DROP TABLE IF EXISTS practice_style_packs");
  d.prepare("INSERT INTO entities (id, type, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "char-1",
    "character",
    "旧角色",
    T1,
    T1,
  );
  setUserVersion(d, 11);
  runMigrations(d, { migrations: [migration012], dbPath: path }); // v11 → v12：旧两表
  // 真实 v12 库持有的旧索引：012 修订后不再自己建它（见该文件头注释），故此处**显式造出**——
  // 不造的话 013 的 `DROP INDEX IF EXISTS` 只走 no-op 分支，删除动作实际未被覆盖。
  // 名字与 `LEGACY_SAMPLE_INDEX` 同名（下面的迁移前断言即锁住这条）。
  d.exec("CREATE INDEX IF NOT EXISTS idx_practice_samples_target ON practice_samples (target_id)");
  d.prepare(
    "INSERT INTO practice_targets (id, name, observation, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("pt-legacy", "旧目标", null, T1, T1);
  d.prepare(
    `INSERT INTO practice_samples (id, target_id, source_kind, source_label, text, draft, feedback, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("ps-legacy", "pt-legacy", "paste", "旧样本", "旧范文", "", null, T1, T1);
  return d;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-migration-013-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath); // 空库路径：CREATE_TABLES_SQL 建出全部表（user_version = 0）
});

afterEach(() => {
  if (db.open) closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("迁移 013（v12 → v13：练习模型重建）", () => {
  it("空库路径与迁移路径建出的三表结构逐项一致（PRAGMA table_info + index_list 独立比对），旧表与旧索引消失", () => {
 // 空库路径：openDatabase → CREATE_TABLES_SQL（before 的 db）
    const fresh = openDatabase(join(dir, "fresh.db"));
    const migratedPath = join(dir, "migrated.db");
    closeDatabase(db); // 本测试用迁移路径的库（db 变量改指它，afterEach 关它）
    db = createV12Db(migratedPath);
    try {
 // 前置：v12 结构 = 旧两表（旧形状）+ 旧索引，自由练习与素材包两表尚不存在
      expect(tableNames(db)).toEqual(expect.arrayContaining([...LEGACY_TABLES]));
      expect(tableStructure(db, "practice_samples").columns.map((c) => c.name)).toContain("target_id");
      expect(practiceSampleIndexNames(db)).toContain(LEGACY_SAMPLE_INDEX);
      for (const table of PRACTICE_TABLES.filter((t) => t !== "practice_samples")) {
        expect(tableStructure(db, table).columns, `${table} 迁移前应不存在`).toEqual([]);
      }

      const { applied } = runMigrations(db, { dbPath: migratedPath });
      expect(applied.map((m) => m.version)).toEqual([13]);
      expect(getUserVersion(db)).toBe(13);

 // 旧结构拆除：旧目标表不存在、样本表换为新形状（旧索引随之消失）
      expect(tableNames(db)).not.toContain("practice_targets");
      expect(tableStructure(db, "practice_samples").columns.map((c) => c.name)).not.toContain("target_id");
      expect(practiceSampleIndexNames(db)).not.toContain(LEGACY_SAMPLE_INDEX);
      expect(tableStructure(db, "practice_samples").indexes).toEqual([]);

 // 逐表逐项比对两条路径的结构快照（列/类型/NOT NULL/缺省/主键 + 索引名/唯一/部分/覆盖列）
      for (const table of PRACTICE_TABLES) {
        expect(tableStructure(db, table), `${table} 两条路径结构不一致`).toEqual(tableStructure(fresh, table));
      }

 // 快照本身不含糊（两条路径同错也拦得住）：三表无索引、列清单与缺省值如契约
      for (const table of PRACTICE_TABLES) {
        expect(tableStructure(fresh, table).indexes, `${table} 不应建索引`).toEqual([]);
      }
      for (const table of PRACTICE_TABLES) {
        expect(tableStructure(fresh, table).columns.map((c) => c.name), table).toEqual(
          PRACTICE_COLUMNS[table],
        );
      }
      expect(tableStructure(fresh, "practice_samples").columns.find((c) => c.name === "work_id")).toMatchObject({
        notNull: false,
        defaultValue: null,
        primaryKeyPosition: 0,
      });
      expect(tableStructure(fresh, "practice_samples").columns.find((c) => c.name === "excerpt_label")).toMatchObject({
        notNull: true,
        defaultValue: "''",
      });
      expect(tableStructure(fresh, "practice_free_pieces").columns.find((c) => c.name === "topic")).toMatchObject({
        notNull: true,
        defaultValue: "''",
      });

      closeDatabase(fresh);
    } finally {
      if (fresh.open) closeDatabase(fresh);
    }
  });

  it("v12 库跑迁移：旧行随旧表消失、既有表数据完好、三表可写可读；重跑与回退版本重跑均幂等", () => {
    closeDatabase(db);
    const migratedPath = join(dir, "v12.db");
    db = createV12Db(migratedPath);
    expect(getUserVersion(db)).toBe(12);

    runMigrations(db, { dbPath: migratedPath });
    expect(getUserVersion(db)).toBe(SCHEMA_VERSION);
 // 纯 DDL 无数据搬移：旧模型的样本行随旧表一并丢弃（旧目标模型无新归属）
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c).toBe(0);
 // 既有表数据完好（不重建、不搬移）
    expect((db.prepare("SELECT COUNT(*) AS c FROM entities").get() as { c: number }).c).toBe(1);

 // 迁移 DDL 建出的表列齐全、可写可读（直插，不经 helper）
    db.prepare(
      "INSERT INTO practice_samples (id, work_id, excerpt_label, text, draft, feedback, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("ps-new", "longzu", "节选", "范文", "", null, T1, T1);
    db.prepare(
      `INSERT INTO practice_free_pieces (id, topic, brief, topic_source, draft, feedback, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("pf-new", "", "", "ai", "", null, T1, T1);
    db.prepare("INSERT INTO practice_style_packs (author_id, content, updated_at) VALUES (?, ?, ?)").run(
      "jiangnan",
      "覆盖内容",
      T1,
    );
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_free_pieces").get() as { c: number }).c).toBe(1);
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_style_packs").get() as { c: number }).c).toBe(1);

    const afterFirst = PRACTICE_TABLES.map((table) => tableStructure(db, table));

 // 幂等：版本已对齐 → 无 pending（不重放）；手工回退版本重跑 → 不报错且结构不变
    // （013 是**破坏性**重建：重放会把旧形状的 practice_samples 整表 DROP 后再建，故已写入的行不保留——
    //  正常路径不存在这种回退（崩溃由 runMigrations 事务回滚，版本与结构同步），此处只锁结构稳定）
    expect(runMigrations(db, { dbPath: migratedPath }).applied).toEqual([]);
    setUserVersion(db, 12);
    expect(() => runMigrations(db, { dbPath: migratedPath })).not.toThrow();
    expect(getUserVersion(db)).toBe(13);
    expect(PRACTICE_TABLES.map((table) => tableStructure(db, table))).toEqual(afterFirst);
    expect((db.prepare("SELECT COUNT(*) AS c FROM practice_samples").get() as { c: number }).c).toBe(0);
  });

  it("全新空库短路（user_version=0 且结构 = 当前 DDL）不被本迁移破坏：只对齐版本号、不备份、不碰 outline.json", () => {
    writeOutlineFile(dir, dirtyTree());
    const outlineBefore = readOutlineFile(dir);

    const { db: active, result } = ensureSchemaCompatible(db, dir, dbPath);

    expect(result.rebuilt).toBe(false);
    expect(result.migrated).toBeUndefined();
    expect(result.backups).toEqual([]);
    expect(active).toBe(db); // 连接原样（未重建）
    expect(getUserVersion(active)).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(13);
    expect(readOutlineFile(dir)).toEqual(outlineBefore); // 大纲未被重置
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
 // 三表已由建库路径就位（无需迁移参与），旧两表不在
    for (const table of PRACTICE_TABLES) {
      expect(tableStructure(active, table).columns.map((c) => c.name), table).toEqual(
        PRACTICE_COLUMNS[table],
      );
    }
    for (const table of LEGACY_TABLES.filter((t) => t !== "practice_samples")) {
      expect(tableStructure(active, table).columns).toEqual([]);
    }
  });
});