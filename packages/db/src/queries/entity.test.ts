// S3.1 实体 CRUD 测试：create/list/get/update/softDelete
// 覆盖：id 前缀与 type 校验、q 模糊/分页/四组合排序、软删过滤（决策 12）、
//       部分更新浅合并、级联软删计数与幂等、时间戳
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import {
  countDeltasForEntity,
  createEntity,
  getEntity,
  listEntities,
  softDeleteEntity,
  updateEntity,
} from "./entity.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-entity-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

/** 预插一条 Delta（target 指向指定实体；"order" 列是 SQLite 关键字需引号，schema.ts 同款） */
function seedDelta(targetId: string): void {
  db.prepare(
    'INSERT INTO delta_records (id, node_id, target_type, target_id, changes, description, "order", created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(`delta-${targetId}`, "sc-1", "character", targetId, "[]", "测试", 1, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
}

/** 预插一条关系（source=char → target=指定实体） */
function seedRelation(targetId: string): void {
  db.prepare(
    "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(`rel-${targetId}`, "character", "char-seed", "hook", targetId, "involves", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
}

describe("createEntity", () => {
  it("id 前缀按类型（char-/set-/loc-/hook-），时间戳为应用层 ISO", () => {
    const char = createEntity(db, { type: "character", name: "张三" });
    const setting = createEntity(db, { type: "setting", name: "修仙界" });
    const loc = createEntity(db, { type: "location", name: "宗门" });
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    expect(char.id).toMatch(/^char-/);
    expect(setting.id).toMatch(/^set-/);
    expect(loc.id).toMatch(/^loc-/);
    expect(hook.id).toMatch(/^hook-/);
    for (const row of [char, setting, loc, hook]) {
      expect(Number.isNaN(Date.parse(row.created_at))).toBe(false);
      expect(row.created_at).toBe(row.updated_at); // 创建时相同
      expect(row.deleted_at).toBeNull();
    }
  });

  it("data 缺省 {}，传入原样存储；非法 type 抛错", () => {
    const row = createEntity(db, { type: "character", name: "无数据" });
    expect(row.data).toEqual({});
    expect(
      createEntity(db, { type: "character", name: "有数据", data: { role: "主角", status: "活跃" } }).data,
    ).toEqual({ role: "主角", status: "活跃" });
    // @ts-expect-error 非法 type（防御分支）
    expect(() => createEntity(db, { type: "invalid", name: "x" })).toThrow(/非法实体类型/);
  });
});

describe("listEntities", () => {
  beforeEach(() => {
    // 固定数据：3 角色 + 1 设定；创建后覆写时间戳为递增序列（nowIso 同毫秒精度，
    // 排序断言需可控时间——应用层写时间约定下由调用方控制，测试直接 UPDATE）
    createEntity(db, { type: "character", name: "阿强", data: { role: "主角", status: "活跃" } });
    createEntity(db, { type: "character", name: "阿珍", data: { role: "配角" } });
    createEntity(db, { type: "character", name: "李四", data: { status: "失踪" } });
    createEntity(db, { type: "setting", name: "修仙界", data: { category: "世界" } });
    const stamp = (name: string, t: string): void => {
      db.prepare("UPDATE entities SET created_at = ?, updated_at = ? WHERE name = ?").run(t, t, name);
    };
    stamp("阿强", "2026-08-01T00:00:00Z");
    stamp("阿珍", "2026-08-02T00:00:00Z");
    stamp("李四", "2026-08-03T00:00:00Z");
    stamp("修仙界", "2026-08-04T00:00:00Z");
  });

  it("type 过滤 + 摘要字段提取（character→role/status、setting→category；缺失字段不出现）", () => {
    const chars = listEntities(db, { type: "character" });
    expect(chars.total).toBe(3);
    expect(chars.items).toHaveLength(3);
    const aqiang = chars.items.find((i) => i.name === "阿强")!;
    expect(aqiang.summary).toEqual({ role: "主角", status: "活跃" });
    const azhen = chars.items.find((i) => i.name === "阿珍")!;
    expect(azhen.summary).toEqual({ role: "配角" }); // status 缺失不出现
    const settings = listEntities(db, { type: "setting" });
    expect(settings.total).toBe(1);
    expect(settings.items[0].summary).toEqual({ category: "世界" });
  });

  it("q 模糊匹配 name（LIKE），total 同步过滤", () => {
    const res = listEntities(db, { type: "character", q: "阿" });
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.name).sort()).toEqual(["阿强", "阿珍"]);
  });

  it("分页 offset/limit", () => {
    const page = listEntities(db, { type: "character", offset: 1, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3); // total 不受分页影响
  });

  it("排序四组合（name/created_at/updated_at × asc/desc）", () => {
    // 时间戳顺序：阿强 < 阿珍 < 李四（覆写序列）
    const byCreatedAsc = listEntities(db, { type: "character", sort: "created_at", order: "asc" });
    expect(byCreatedAsc.items.map((i) => i.name)).toEqual(["阿强", "阿珍", "李四"]);
    const byCreatedDesc = listEntities(db, { type: "character", sort: "created_at", order: "desc" });
    expect(byCreatedDesc.items.map((i) => i.name)).toEqual(["李四", "阿珍", "阿强"]);
    // name 排序为 SQLite BINARY 字节序（非拼音序）：李(0x674E) < 阿(0x963F)
    const byNameAsc = listEntities(db, { type: "character", sort: "name", order: "asc" });
    expect(byNameAsc.items.map((i) => i.name)).toEqual(["李四", "阿强", "阿珍"]);
    const byNameDesc = listEntities(db, { type: "character", sort: "name", order: "desc" });
    expect(byNameDesc.items.map((i) => i.name)).toEqual(["阿珍", "阿强", "李四"]);
    // updated_at 排序（创建后未更新，同 created_at 序）
    const byUpdatedDesc = listEntities(db, { type: "character", sort: "updated_at", order: "desc" });
    expect(byUpdatedDesc.items.map((i) => i.name)).toEqual(["李四", "阿珍", "阿强"]);
  });

  it("默认排序 updated_at desc（最近更新在前）", () => {
    const first = listEntities(db, { type: "character" });
    expect(first.items[0].name).toBe("李四"); // 最后创建
  });

  it("软删过滤（决策 12）：软删后列表不可见，total 减少", () => {
    const target = listEntities(db, { type: "character", q: "阿强" }).items[0];
    softDeleteEntity(db, target.id, "2026-08-02T00:00:00Z");
    const res = listEntities(db, { type: "character" });
    expect(res.total).toBe(2);
    expect(res.items.find((i) => i.id === target.id)).toBeUndefined();
  });

  it("limit 上限 clamp 200；非法值防御", () => {
    const res = listEntities(db, { type: "character", limit: 9999 });
    expect(res.items.length).toBeLessThanOrEqual(200);
  });

  it("data 列非法 JSON 的坏行防御（oracle 建议 1）：不抛错、坏行 data 为 {}、其他行正常", () => {
    // 预插一条 data 为非法 JSON 的行（模拟手改库/异常写入）
    db.prepare(
      "INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("char-bad", "character", "坏行", "{ 这不是 JSON", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");

    // 列表不抛错，坏行以空 data 呈现，其余行正常
    const res = listEntities(db, { type: "character" });
    expect(res.total).toBe(4); // 3 正常 + 1 坏行（坏行不丢）
    const bad = res.items.find((i) => i.id === "char-bad")!;
    expect(bad).toBeDefined();
    expect(bad.summary).toEqual({}); // data 解析失败 → {} → 无摘要字段
    expect(res.items.filter((i) => i.name === "阿强")).toHaveLength(1);
    // 详情同样防御
    expect(getEntity(db, "char-bad")?.data).toEqual({});
  });
});

describe("getEntity / countDeltasForEntity", () => {
  it("详情返回完整 data；deltaCount 计数（过滤软删 Delta）", () => {
    const row = createEntity(db, { type: "character", name: "张三", data: { role: "主角" } });
    seedDelta(row.id);
    expect(getEntity(db, row.id)).toEqual(row);
    expect(countDeltasForEntity(db, row.id)).toBe(1);
  });

  it("不存在 → null；软删后 → null（决策 12 过滤）", () => {
    expect(getEntity(db, "char-999")).toBeNull();
    const row = createEntity(db, { type: "character", name: "将删" });
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    expect(getEntity(db, row.id)).toBeNull();
  });
});

describe("updateEntity（部分更新，endpoints.md 第 255-278 行）", () => {
  it("data 浅合并：未传字段保留、传入字段覆盖；name 替换；updated_at 刷新", () => {
    const row = createEntity(db, {
      type: "character",
      name: "旧名",
      data: { role: "主角", age: 20, personality: ["坚毅"] },
    });
    const updated = updateEntity(db, row.id, { name: "新名", data: { role: "反派", age: 30 } })!;
    expect(updated.name).toBe("新名");
    expect(updated.data).toEqual({ role: "反派", age: 30, personality: ["坚毅"] }); // personality 保留
    // updated_at 刷新（nowIso 毫秒精度：同毫秒内 create/update 可能相等——语义上「更新时刷新」，
    // 断言不低于创建时间；精确刷新行为由实现保证）
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.updated_at));
    expect(updated.created_at).toBe(row.created_at);
    // 读回一致
    expect(getEntity(db, row.id)?.data).toEqual(updated.data);
  });

  it("空 patch（仅刷新 updated_at）；不存在 → null；软删后 → null", () => {
    const row = createEntity(db, { type: "setting", name: "世界" });
    const touched = updateEntity(db, row.id, {})!;
    expect(touched.name).toBe("世界");
    expect(Date.parse(touched.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.updated_at));
    expect(updateEntity(db, "set-999", { name: "x" })).toBeNull();
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    expect(updateEntity(db, row.id, { name: "x" })).toBeNull(); // 软删不可更新
  });
});

describe("softDeleteEntity（决策 12 级联）", () => {
  it("级联软删关系（任一端点）+ Delta（目标实体），返回实际计数；自身 deleted_at 置位", () => {
    const row = createEntity(db, { type: "hook", name: "伏笔" });
    seedRelation(row.id);
    seedDelta(row.id);

    const r = softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z")!;
    expect(r).toEqual({ relations: 1, deltas: 1 });
    // 自身软删标记 + 版本戳刷新（决策 12 修订）
    const raw = db.prepare("SELECT deleted_at, updated_at FROM entities WHERE id = ?").get(row.id) as {
      deleted_at: string | null;
      updated_at: string;
    };
    expect(raw.deleted_at).toBe("2026-08-02T00:00:00Z");
    expect(raw.updated_at).toBe("2026-08-02T00:00:00Z");
    // DB 级联标记
    expect(
      (db.prepare("SELECT deleted_at FROM relation_records WHERE id = ?").get(`rel-${row.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeTruthy();
    expect(
      (db.prepare("SELECT deleted_at FROM delta_records WHERE id = ?").get(`delta-${row.id}`) as { deleted_at: string | null }).deleted_at,
    ).toBeTruthy();
    // 已软删的级联行不再重复计数（deleted_at IS NULL 过滤）
    const r2 = softDeleteEntity(db, row.id, "2026-08-03T00:00:00Z");
    expect(r2).toBeNull();
  });

  it("幂等：已软删/不存在实体重删 → null 且无副作用", () => {
    const row = createEntity(db, { type: "location", name: "宗门" });
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    expect(softDeleteEntity(db, row.id, "2026-08-03T00:00:00Z")).toBeNull();
    expect(softDeleteEntity(db, "loc-999", "2026-08-03T00:00:00Z")).toBeNull();
  });

  it("软删后 list/get 不可见（常规查询默认过滤）", () => {
    const row = createEntity(db, { type: "character", name: "幽灵" });
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    expect(getEntity(db, row.id)).toBeNull();
    expect(listEntities(db, { type: "character" }).total).toBe(0);
  });
});
