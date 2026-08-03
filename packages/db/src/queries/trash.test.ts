// S4.1 回收站数据层测试：实体列表/级联还原/物理清除 + 级联 helper（自 server 下沉）
// 覆盖：deleted_at 倒序列表、restore 级联还原计数与 updated_at 刷新、幂等（未软删/不存在/
//       类型不匹配/重复还原）、另一端仍软删的关系也全部还原（决策 12 修订）、
//       purge 物理清除本体+关系+Delta、cascadeRestore/cascadePurge 语义不变
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { createEntity, softDeleteEntity } from "./entity.js";
import { cascadePurge, cascadeRestore, listDeletedEntities, purgeEntity, restoreEntity } from "./trash.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-trash-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T1 = "2026-08-01T00:00:00Z";
const T2 = "2026-08-02T00:00:00Z";
const T3 = "2026-08-03T00:00:00Z";

/** 预插一条 Delta（target 指向指定实体；触发节点固定 sc-1，schema.ts 同款列集） */
function seedDelta(targetId: string): void {
  db.prepare(
    'INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(`delta-${targetId}`, "sc-1", "character", targetId, "[]", "测试", 1, T1, T1);
}

/** 预插一条关系（source=char-seed → target=指定实体；involves 合法类型） */
function seedRelation(targetId: string): void {
  db.prepare(
    "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(`rel-${targetId}`, "character", "char-seed", "hook", targetId, "involves", T1, T1);
}

/** 预插一条 source → target 的关系（端点可控，供「另一端仍软删」用例） */
function seedRelationBetween(relId: string, sourceId: string, targetId: string): void {
  db.prepare(
    "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(relId, "character", sourceId, "hook", targetId, "involves", T1, T1);
}

/** 预插一条触发节点为指定 node_id 的 Delta（级联 helper 用例） */
function seedDeltaForNode(nodeId: string): void {
  db.prepare(
    'INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(`delta-${nodeId}`, nodeId, "character", "char-seed", "[]", "测试", 1, T1, T1);
}

describe("listDeletedEntities（GET /api/v1/trash entities 侧）", () => {
  it("只含软删实体，按 deleted_at 倒序，字段 { id, type, name, deletedAt }", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "hook", name: "乙" });
    const c = createEntity(db, { type: "setting", name: "丙" });
    createEntity(db, { type: "location", name: "存活者" }); // 未软删，不出现
    softDeleteEntity(db, a.id, T1);
    softDeleteEntity(db, c.id, T2);
    softDeleteEntity(db, b.id, T3);

    expect(listDeletedEntities(db)).toEqual([
      { id: b.id, type: "hook", name: "乙", deletedAt: T3 },
      { id: c.id, type: "setting", name: "丙", deletedAt: T2 },
      { id: a.id, type: "character", name: "甲", deletedAt: T1 },
    ]);
  });

  it("回收站为空 → []", () => {
    createEntity(db, { type: "character", name: "存活" });
    expect(listDeletedEntities(db)).toEqual([]);
  });
});

describe("restoreEntity（决策 12 修订）", () => {
  it("级联还原关系（任一端点）+ Delta（target_id），计数正确；自身 deleted_at 置 NULL + updated_at 刷新", () => {
    const row = createEntity(db, { type: "hook", name: "伏笔" });
    seedRelation(row.id);
    seedDelta(row.id);
    softDeleteEntity(db, row.id, T2);

    const r = restoreEntity(db, "hook", row.id)!;
    expect(r).toEqual({ restoredRelations: 1, restoredDeltas: 1 });
    // 自身：deleted_at 置 NULL + updated_at 刷新（决策 12 修订——刷新时间 >= 软删时间）
    const raw = db.prepare("SELECT deleted_at, updated_at FROM entities WHERE id = ?").get(row.id) as {
      deleted_at: string | null;
      updated_at: string;
    };
    expect(raw.deleted_at).toBeNull();
    expect(Date.parse(raw.updated_at)).toBeGreaterThanOrEqual(Date.parse(T2));
    expect(raw.updated_at).not.toBe(T2); // 还原刷新（nowIso 当前时间 > 固定软删时间）
    // 级联行已还原
    expect(
      (db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get(`rel-${row.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeNull();
    expect(
      (db.prepare("SELECT deleted_at FROM delta_records WHERE id = ?").get(`delta-${row.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeNull();
  });

  it("另一端仍软删的关系也被还原（决策 12 修订：全部还原，不跳过）", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "hook", name: "乙" });
    seedRelationBetween(`rel-${a.id}`, a.id, b.id); // a → b
    seedDelta(a.id); // Delta target = a
    softDeleteEntity(db, a.id, T2); // 级联软删 rel/delta
    softDeleteEntity(db, b.id, T3); // b 仍在回收站（rel 已软删，不重复标记）

    const r = restoreEntity(db, "character", a.id)!;
    expect(r).toEqual({ restoredRelations: 1, restoredDeltas: 1 });
    // 关系已还原，即使另一端 b 仍软删
    expect(
      (db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get(`rel-${a.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeNull();
    expect(
      (db.prepare("SELECT deleted_at FROM entities WHERE id = ?").get(b.id) as { deleted_at: string | null }).deleted_at,
    ).not.toBeNull(); // b 仍在回收站
    expect(
      (db.prepare("SELECT deleted_at FROM delta_records WHERE id = ?").get(`delta-${a.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeNull();
  });

  it("幂等：未软删/不存在/类型不匹配 → null 且无副作用", () => {
    // 未软删（含已还原）→ null：updated_at 与级联行均不受影响
    const alive = createEntity(db, { type: "character", name: "存活" });
    seedRelation(alive.id);
    const before = db.prepare("SELECT updated_at FROM entities WHERE id = ?").get(alive.id) as { updated_at: string };
    expect(restoreEntity(db, "character", alive.id)).toBeNull();
    expect(
      (db.prepare("SELECT updated_at FROM entities WHERE id = ?").get(alive.id) as { updated_at: string }).updated_at,
    ).toBe(before.updated_at);
    expect(
      (db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get(`rel-${alive.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeNull(); // 级联行未被触碰

    // 不存在 → null
    expect(restoreEntity(db, "character", "char-999")).toBeNull();
    // 类型不匹配 → null（视同不存在）
    const b = createEntity(db, { type: "hook", name: "乙" });
    softDeleteEntity(db, b.id, T2);
    expect(restoreEntity(db, "setting", b.id)).toBeNull();
    expect(
      (db.prepare("SELECT deleted_at FROM entities WHERE id = ?").get(b.id) as { deleted_at: string | null }).deleted_at,
    ).not.toBeNull(); // 仍在回收站
  });
});

describe("purgeEntity（物理清除）", () => {
  it("清除实体本体 + 关联关系与 Delta；返回 true", () => {
    const row = createEntity(db, { type: "hook", name: "伏笔" });
    seedRelation(row.id);
    seedDelta(row.id);
    softDeleteEntity(db, row.id, T2);

    expect(purgeEntity(db, "hook", row.id)).toBe(true);
    expect(db.prepare("SELECT id FROM entities WHERE id = ?").get(row.id)).toBeUndefined();
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get(`rel-${row.id}`)).toBeUndefined();
    expect(db.prepare("SELECT id FROM delta_records WHERE id = ?").get(`delta-${row.id}`)).toBeUndefined();
    expect(listDeletedEntities(db)).toEqual([]);
  });

  it("幂等：不存在/类型不匹配 → null 且无副作用", () => {
    expect(purgeEntity(db, "character", "char-999")).toBeNull();
    const row = createEntity(db, { type: "hook", name: "乙" });
    expect(purgeEntity(db, "setting", row.id)).toBeNull();
    expect(db.prepare("SELECT id FROM entities WHERE id = ?").get(row.id)).toBeDefined();
  });

  it("未软删实体也可物理清除（本层不拦截——「仅回收站清理」语义由路由层 S4.3 拦截）", () => {
    const row = createEntity(db, { type: "character", name: "直接清" });
    seedRelation(row.id);
    expect(purgeEntity(db, "character", row.id)).toBe(true);
    expect(db.prepare("SELECT id FROM entities WHERE id = ?").get(row.id)).toBeUndefined();
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get(`rel-${row.id}`)).toBeUndefined();
  });
});

describe("cascadeRestore / cascadePurge（自 outline.ts 下沉，语义不变）", () => {
  it("cascadeRestore：source/target 命中与 node_id 命中的已软删行全部还原，返回计数", () => {
    seedRelationBetween("rel-1", "sc-1", "char-x");
    seedRelationBetween("rel-2", "char-y", "sc-2");
    seedRelationBetween("rel-3", "char-y", "char-x"); // 不命中子树 → 不动
    seedDeltaForNode("sc-1");
    seedDeltaForNode("sc-3"); // 不命中 → 不动
    db.prepare("UPDATE relation_records SET deleted_at = ? WHERE id IN ('rel-1','rel-2','rel-3')").run(T2);
    db.prepare("UPDATE delta_records SET deleted_at = ? WHERE id IN ('delta-sc-1','delta-sc-3')").run(T2);

    const r = cascadeRestore(db, ["sc-1", "sc-2"]);
    expect(r).toEqual({ relations: 2, deltas: 1 });
    const relDeleted = (id: string): string | null =>
      (db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get(id) as { deleted_at: string | null }).deleted_at;
    expect(relDeleted("rel-1")).toBeNull();
    expect(relDeleted("rel-2")).toBeNull();
    expect(relDeleted("rel-3")).not.toBeNull(); // 未命中子树保持软删
    expect(
      (db.prepare("SELECT deleted_at FROM delta_records WHERE id = ?").get("delta-sc-1") as { deleted_at: string | null }).deleted_at,
    ).toBeNull();
    expect(
      (db.prepare("SELECT deleted_at FROM delta_records WHERE id = ?").get("delta-sc-3") as { deleted_at: string | null }).deleted_at,
    ).not.toBeNull();
  });

  it("cascadeRestore：未软删行不动；空集无副作用", () => {
    seedRelationBetween("rel-1", "sc-1", "char-x");
    expect(cascadeRestore(db, [])).toEqual({ relations: 0, deltas: 0 });
    expect(
      (db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get("rel-1") as { deleted_at: string | null }).deleted_at,
    ).toBeNull(); // 未软删行不受影响
  });

  it("cascadePurge：source/target/node_id 命中的行物理删除，未命中保留", () => {
    seedRelationBetween("rel-1", "sc-1", "char-x");
    seedRelationBetween("rel-2", "char-y", "sc-2");
    seedRelationBetween("rel-3", "char-y", "char-x"); // 不命中 → 保留
    seedDeltaForNode("sc-1");
    seedDeltaForNode("sc-3"); // 不命中 → 保留

    cascadePurge(db, ["sc-1", "sc-2"]);
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get("rel-1")).toBeUndefined();
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get("rel-2")).toBeUndefined();
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get("rel-3")).toBeDefined();
    expect(db.prepare("SELECT id FROM delta_records WHERE id = ?").get("delta-sc-1")).toBeUndefined();
    expect(db.prepare("SELECT id FROM delta_records WHERE id = ?").get("delta-sc-3")).toBeDefined();
  });

  it("cascadePurge：空集无副作用", () => {
    seedRelationBetween("rel-1", "sc-1", "char-x");
    cascadePurge(db, []);
    expect(db.prepare("SELECT id FROM relation_records WHERE id = ?").get("rel-1")).toBeDefined();
  });
});
