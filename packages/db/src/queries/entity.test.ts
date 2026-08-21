// S3.1 实体 CRUD 测试：create/list/get/update/softDelete
// 覆盖：id 前缀与 type 校验、q 模糊/分页/四组合排序、软删过滤（决策 12）、
//       部分更新浅合并、级联软删计数与幂等、时间戳
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDatabase, openDatabase, type Db } from "../connection.js";
import { RelationError } from "./relation.js";
import {
  assertEventSingleOccursAt,
  countDeltasForEntity,
  createEntity,
  eventOccursAt,
  getEntity,
  getEntitySummaryStats,
  listEntities,
  listTimepoints,
  moveEvent,
  moveTimepoint,
  reorderTimepoints,
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
  it("id 前缀按类型（char-/set-/loc-/hook-/ev-），时间戳为应用层 ISO", () => {
    const char = createEntity(db, { type: "character", name: "张三" });
    const setting = createEntity(db, { type: "setting", name: "修仙界" });
    const loc = createEntity(db, { type: "location", name: "宗门" });
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    const event = createEntity(db, { type: "event", name: "藏经阁发现玉佩" });
    expect(char.id).toMatch(/^char-/);
    expect(setting.id).toMatch(/^set-/);
    expect(loc.id).toMatch(/^loc-/);
    expect(hook.id).toMatch(/^hook-/);
    expect(event.id).toMatch(/^ev-/);
    for (const row of [char, setting, loc, hook, event]) {
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
    createEntity(db, { type: "setting", name: "修仙界", data: { tags: ["世界"] } });
    const stamp = (name: string, t: string): void => {
      db.prepare("UPDATE entities SET created_at = ?, updated_at = ? WHERE name = ?").run(t, t, name);
    };
    stamp("阿强", "2026-08-01T00:00:00Z");
    stamp("阿珍", "2026-08-02T00:00:00Z");
    stamp("李四", "2026-08-03T00:00:00Z");
    stamp("修仙界", "2026-08-04T00:00:00Z");
  });

  it("type 过滤 + 摘要字段提取（character→role/status、setting→tags（决策 31）；缺失字段不出现）", () => {
    const chars = listEntities(db, { type: "character" });
    expect(chars.total).toBe(3);
    expect(chars.items).toHaveLength(3);
    const aqiang = chars.items.find((i) => i.name === "阿强")!;
    expect(aqiang.summary).toEqual({ role: "主角", status: "活跃" });
    const azhen = chars.items.find((i) => i.name === "阿珍")!;
    expect(azhen.summary).toEqual({ role: "配角" }); // status 缺失不出现
    const settings = listEntities(db, { type: "setting" });
    expect(settings.total).toBe(1);
    expect(settings.items[0].summary).toEqual({ tags: ["世界"] });
  });

  it("character 摘要含两行式行布局字段（决策 45：motivation 截断 40 / personality / abilities 各前 2；缺失不出现）", () => {
    const longMotivation = "他".repeat(60);
    createEntity(db, { type: "character", name: "行布局测试", data: { motivation: longMotivation, personality: ["坚韧", "孤僻", "善良"], abilities: ["剑术", "阵法", "医术"] } });
    createEntity(db, { type: "character", name: "行布局空", data: { role: "配角" } });
    const items = listEntities(db, { type: "character" }).items;
    const rich = items.find((i) => i.name === "行布局测试")!;
    expect(rich.summary.motivation).toBe("他".repeat(40)); // 截断 40
    expect(rich.summary.personality).toEqual(["坚韧", "孤僻"]); // 前 2
    expect(rich.summary.abilities).toEqual(["剑术", "阵法"]); // 前 2
    const empty = items.find((i) => i.name === "行布局空")!;
    expect(empty.summary).toEqual({ role: "配角" }); // 新字段缺失不出现
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

  it("filters.status：data.status 精确匹配（S6.3 工具 search_entities 下沉）", () => {
    const alive = listEntities(db, { type: "character", filters: { status: "活跃" } });
    expect(alive.items.map((i) => i.name)).toEqual(["阿强"]);
    expect(alive.total).toBe(1);
    const missing = listEntities(db, { type: "character", filters: { status: "不存在" } });
    expect(missing.items).toEqual([]);
    // 与 q 组合过滤
    const qAnd = listEntities(db, { type: "character", q: "阿", filters: { status: "失踪" } });
    expect(qAnd.items).toEqual([]); // 阿强/阿珍均非失踪
  });

  it("filters.tags：data.tags 数组须包含全部指定标签（AND）；非数组/缺标签不匹配", () => {
    createEntity(db, { type: "character", name: "赵六", data: { tags: ["门派甲", "主世界"] } });
    createEntity(db, { type: "character", name: "钱七", data: { tags: ["门派甲"] } });
    createEntity(db, { type: "character", name: "孙八", data: { tags: "非数组" } });
    const r1 = listEntities(db, { type: "character", filters: { tags: ["门派甲"] } });
    expect(r1.items.map((i) => i.name).sort()).toEqual(["赵六", "钱七"]);
    const r2 = listEntities(db, { type: "character", filters: { tags: ["门派甲", "主世界"] } });
    expect(r2.items.map((i) => i.name)).toEqual(["赵六"]); // AND 语义
    const r3 = listEntities(db, { type: "character", filters: { tags: ["不存在"] } });
    expect(r3.items).toEqual([]);
    expect(r3.total).toBe(0);
    // 非数组 tags 一律不匹配（防御）
    expect(listEntities(db, { type: "character", filters: { tags: ["非数组"] } }).items).toEqual([]);
  });

  it("filters 分支：total 为 filters 过滤后总数（不含分页）；分页作用于过滤后", () => {
    createEntity(db, { type: "character", name: "赵六", data: { status: "活跃" } });
    createEntity(db, { type: "character", name: "钱七", data: { status: "活跃" } });
    const res = listEntities(db, { type: "character", filters: { status: "活跃" }, offset: 1, limit: 1 });
    expect(res.total).toBe(3); // 阿强 + 赵六 + 钱七（过滤后总数，不受分页影响）
    expect(res.items).toHaveLength(1); // 分页第二页
  });

  it("filters 分支：软删实体不参与（决策 12）", () => {
    const target = listEntities(db, { type: "character", q: "阿强" }).items[0];
    softDeleteEntity(db, target.id, "2026-08-02T00:00:00Z");
    const res = listEntities(db, { type: "character", filters: { status: "活跃" } });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
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

describe("getEntitySummaryStats（S6.3 工具 get_entity_summary 下沉）", () => {
  it("character：total/byRole/byStatus/topAbilities（软删不计入，决策 12）", () => {
    createEntity(db, {
      type: "character",
      name: "阿强",
      data: { role: "主角", status: "alive", abilities: ["剑术", "轻功"] },
    });
    createEntity(db, {
      type: "character",
      name: "阿珍",
      data: { role: "配角", status: "alive", abilities: ["剑术"] },
    });
    const dead = createEntity(db, {
      type: "character",
      name: "阿灭",
      data: { role: "反派", status: "dead", abilities: ["毒术"] },
    });
    softDeleteEntity(db, dead.id, "2026-08-02T00:00:00Z");

    const result = getEntitySummaryStats(db, "character");
    expect(result.total).toBe(2);
    expect(result.byRole).toEqual({ 主角: 1, 配角: 1 });
    expect(result.byStatus).toEqual({ alive: 2 });
    // 能力分布按频率降序、同频名称序
    expect(result.topAbilities).toEqual([
      { ability: "剑术", count: 2 },
      { ability: "轻功", count: 1 },
    ]);
  });

  it("hook：byStatus/byPayoffTiming；setting：byTags（决策 31）；location：byType（稀疏分布）", () => {
    createEntity(db, { type: "hook", name: "密信", data: { status: "planted", payoff_timing: "chapter" } });
    createEntity(db, { type: "hook", name: "遗物", data: { status: "planted", payoff_timing: "book" } });
    const hook = getEntitySummaryStats(db, "hook");
    expect(hook).toEqual({
      type: "hook",
      total: 2,
      byStatus: { planted: 2 },
      byPayoffTiming: { chapter: 1, book: 1 },
    });
    expect(hook.byRole).toBeUndefined(); // 非 character 不出现角色分布

    createEntity(db, { type: "setting", name: "修真界", data: { tags: ["世界观"] } });
    createEntity(db, { type: "setting", name: "江湖", data: { tags: ["世界观"] } });
    createEntity(db, { type: "setting", name: "门派", data: { tags: ["组织"] } });
    expect(getEntitySummaryStats(db, "setting")).toEqual({
      type: "setting",
      total: 3,
      byTags: { 世界观: 2, 组织: 1 },
    });

    createEntity(db, { type: "location", name: "青城山", data: { type: "山门" } });
    createEntity(db, { type: "location", name: "藏经阁", data: { type: "建筑" } });
    expect(getEntitySummaryStats(db, "location")).toEqual({
      type: "location",
      total: 2,
      byType: { 山门: 1, 建筑: 1 },
    });
  });

  it("缺字段/坏行不报错：无 data 字段不计入分布；data 非法 JSON 按空 data 防御", () => {
    createEntity(db, { type: "character", name: "无字段者" }); // data 空
    createEntity(db, { type: "character", name: "空字符串分布" }); // 同上
    // 预插一条 data 为非法 JSON 的行（手改库/异常写入；parseDataColumn 防御 → {}）
    db.prepare(
      "INSERT INTO entities (id, type, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("char-bad", "character", "坏行", "{ 这不是 JSON", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");

    const result = getEntitySummaryStats(db, "character");
    expect(result.total).toBe(3); // 2 正常 + 1 坏行（坏行不丢，data 视为 {}）
    expect(result.byRole).toEqual({});
    expect(result.byStatus).toEqual({});
    expect(result.topAbilities).toEqual([]);
  });

  it("空类型：total 0，分布字段为空对象", () => {
    expect(getEntitySummaryStats(db, "character")).toEqual({
      type: "character",
      total: 0,
      byRole: {},
      byStatus: {},
      topAbilities: [],
    });
  });
});

// ============ 时间轴事件（决策 26）：listEntities 固定排序 + moveEvent ============

describe("listEntities event（时间轴事件固定排序，决策 26）", () => {
  /** 造 n 个 event，sort_order 按给定序列赋值（NULL 表示未设） */
  function seedEvents(names: string[], sortOrders: Array<number | null>): string[] {
    const ids: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const id = `ev-seed-${i}`;
      ids.push(id);
      const sort = sortOrders[i];
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
         VALUES (?, 'event', ?, ?, ?, ?)`,
      ).run(id, names[i], sort, `2026-08-0${i + 1}T00:00:00Z`, `2026-08-0${i + 1}T00:00:00Z`);
    }
    return ids;
  }

  it("恒按 sort_order 升序（NULL 沉底、id 稳定次序）；忽略 sort/order 参数（endpoints.md 契约）", () => {
    seedEvents(["事件C", "事件A", "事件D", "事件B"], [2, 0, null, 1]);
    const res = listEntities(db, { type: "event" });
    expect(res.items.map((i) => i.name)).toEqual(["事件A", "事件B", "事件C", "事件D"]); // NULL 沉底
    // sort/order 参数不参与事件排序——显式传 desc 仍按 sort_order 升序
    const desc = listEntities(db, { type: "event", sort: "created_at", order: "desc" });
    expect(desc.items.map((i) => i.name)).toEqual(["事件A", "事件B", "事件C", "事件D"]);
    // q 过滤 + 分页照常生效
    const page = listEntities(db, { type: "event", offset: 1, limit: 2 });
    expect(page.items.map((i) => i.name)).toEqual(["事件B", "事件C"]);
    expect(page.total).toBe(4);
  });

  it("事件与其他类型互不干扰：非 event 类型仍按 sort/order 参数排序", () => {
    createEntity(db, { type: "character", name: "甲" });
    createEntity(db, { type: "character", name: "乙" });
    // 覆写时间戳为递增序列（nowIso 同毫秒精度，排序断言需可控时间——既有测试同款做法）
    db.prepare("UPDATE entities SET created_at = ?, updated_at = ? WHERE name = ?").run(
      "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z", "甲",
    );
    db.prepare("UPDATE entities SET created_at = ?, updated_at = ? WHERE name = ?").run(
      "2026-08-02T00:00:00Z", "2026-08-02T00:00:00Z", "乙",
    );
    const res = listEntities(db, { type: "character", sort: "created_at", order: "desc" });
    expect(res.items.map((i) => i.name)).toEqual(["乙", "甲"]);
  });

  it("filters 分支同样固定 sort_order 排序（data.tags 过滤后仍为时间轴序）", () => {
    seedEvents(["事件A", "事件B", "事件C"], [2, 0, 1]);
    // 给事件 A/B 打 tags（filters 走 JS 层过滤路径）
    db.prepare("UPDATE entities SET data = ? WHERE name = ?").run(
      JSON.stringify({ tags: ["主线"] }),
      "事件B",
    );
    db.prepare("UPDATE entities SET data = ? WHERE name = ?").run(
      JSON.stringify({ tags: ["主线"] }),
      "事件C",
    );
    const res = listEntities(db, { type: "event", filters: { tags: ["主线"] } });
    expect(res.items.map((i) => i.name)).toEqual(["事件B", "事件C"]); // 仍按 sort_order 0,1
  });

  it("event 摘要字段提取：description/tags（endpoints.md L269 契约；字段缺失不出现）", () => {
    seedEvents(["事件A", "事件B"], [0, 1]);
    db.prepare("UPDATE entities SET data = ? WHERE name = '事件A'").run(
      JSON.stringify({ description: "藏经阁发现玉佩", tags: ["主线", "伏笔"] }),
    );
    const res = listEntities(db, { type: "event" });
    const a = res.items.find((i) => i.name === "事件A")!;
    expect(a.summary).toEqual({
      description: "藏经阁发现玉佩",
      tags: ["主线", "伏笔"],
    });
    // 字段缺失不出现（稀疏语义）——事件B 无 data
    const b = res.items.find((i) => i.name === "事件B")!;
    expect(b.summary).toEqual({});
  });

  it("软删事件不参与列表（决策 12 过滤）", () => {
    const [a, b, c] = seedEvents(["事件A", "事件B", "事件C"], [0, 1, 2]);
    softDeleteEntity(db, b, "2026-08-02T00:00:00Z");
    const res = listEntities(db, { type: "event" });
    expect(res.items.map((i) => i.id)).toEqual([a, c]); // B 软删不可见
  });
});

describe("moveEvent（PUT /api/v1/entity/event/:id/move，决策 26）", () => {
  /** 造 n 个 event，sort_order 0..n-1；返回 id 数组（按序） */
  function seedEvents(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `ev-move-${i}`;
      ids.push(id);
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
         VALUES (?, 'event', ?, ?, ?, ?)`,
      ).run(id, `事件${i}`, i, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }
    return ids;
  }

  /** 读全部未软删 event 的 id（按 sort_order 升序、NULL 沉底） */
  function eventIdsInOrder(): string[] {
    const rows = db
      .prepare(
        `SELECT id FROM entities WHERE type = 'event' AND deleted_at IS NULL
         ORDER BY sort_order IS NULL, sort_order ASC, id ASC`,
      )
      .all() as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  it("顺序重排：移后重写全局线性序 0..n-1，其余事件序保持相对位置", () => {
    const ids = seedEvents(4); // [0,1,2,3]
    // 把 id[2] 移到位置 0 → [2,0,1,3]
    expect(moveEvent(db, ids[2], 0, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(eventIdsInOrder()).toEqual([ids[2], ids[0], ids[1], ids[3]]);
    // 再移 id[0] 到末尾（order 3）→ [2,1,3,0]
    expect(moveEvent(db, ids[0], 3, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(eventIdsInOrder()).toEqual([ids[2], ids[1], ids[3], ids[0]]);
    // sort_order 列已重写为连续 0..n-1（可验证）
    const orders = db
      .prepare("SELECT sort_order FROM entities WHERE type = 'event' ORDER BY sort_order")
      .all() as Array<{ sort_order: number }>;
    expect(orders.map((o) => o.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("updated_at：仅被移动行刷新（传入新时间戳），其余行保持不变（决策 14 版本戳语义）", () => {
    const ids = seedEvents(3); // 种子 updated_at = 2026-08-01T00:00:00Z
    expect(moveEvent(db, ids[2], 0, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    const rows = db
      .prepare("SELECT id, updated_at FROM entities WHERE type = 'event'")
      .all() as Array<{ id: string; updated_at: string }>;
    const byId = new Map(rows.map((r) => [r.id, r.updated_at]));
    expect(byId.get(ids[2])).toBe("2026-08-02T00:00:00Z"); // 被移行：刷新为传入时间戳
    expect(byId.get(ids[0])).toBe("2026-08-01T00:00:00Z"); // 未移行：保持不变
    expect(byId.get(ids[1])).toBe("2026-08-01T00:00:00Z");
  });

  it("clamp 边界：负数 → 0；超总数 → 末尾（endpoints.md 契约）", () => {
    const ids = seedEvents(3); // [0,1,2]
    expect(moveEvent(db, ids[2], -5, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(eventIdsInOrder()).toEqual([ids[2], ids[0], ids[1]]); // 负数 clamp 到 0
    expect(moveEvent(db, ids[1], 999, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(eventIdsInOrder()).toEqual([ids[2], ids[0], ids[1]]); // 999 → 末尾（已在末尾，序不变）
  });

  it("原地移动：order = 当前位置 → 序不变，updated_at 仍刷新", () => {
    const ids = seedEvents(3);
    expect(moveEvent(db, ids[1], 1, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(eventIdsInOrder()).toEqual(ids);
    const raw = db.prepare("SELECT updated_at FROM entities WHERE id = ?").get(ids[1]) as { updated_at: string };
    expect(raw.updated_at).toBe("2026-08-02T00:00:00Z");
  });

  it("NULL sort_order 沉底参与排序：旧数据（迁移来的 NULL 序）可正常重排", () => {
    const ids: string[] = [];
    const inserts: Array<[string, string, number | null]> = [
      ["ev-null-0", "空序A", null],
      ["ev-null-1", "空序B", null],
      ["ev-1", "有序1", 1],
    ];
    for (const [id, name, sort] of inserts) {
      ids.push(id);
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at) VALUES (?, 'event', ?, ?, ?, ?)`,
      ).run(id, name, sort, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }
    // 初始：有序1（sort=1）在前，两个 NULL 沉底（id 序）
    expect(eventIdsInOrder()).toEqual(["ev-1", "ev-null-0", "ev-null-1"]);
    // 把 ev-null-0 移到 0 → NULL 行获得全局线性序 0
    expect(moveEvent(db, "ev-null-0", 0, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(eventIdsInOrder()).toEqual(["ev-null-0", "ev-1", "ev-null-1"]);
    // 全部行重写为连续序（NULL 清零）
    const orders = db
      .prepare("SELECT sort_order FROM entities WHERE type = 'event' ORDER BY sort_order")
      .all() as Array<{ sort_order: number }>;
    expect(orders.map((o) => o.sort_order)).toEqual([0, 1, 2]);
  });

  it("软删事件不可 move（返回 null）；不存在返回 null", () => {
    const ids = seedEvents(2);
    softDeleteEntity(db, ids[0], "2026-08-02T00:00:00Z");
    expect(moveEvent(db, ids[0], 1, "2026-08-02T00:00:00Z")).toBeNull();
    expect(moveEvent(db, "ev-999", 0, "2026-08-02T00:00:00Z")).toBeNull();
    // 软删事件不参与剩余事件的排序空间（列表已过滤）
    expect(eventIdsInOrder()).toEqual([ids[1]]);
  });

  it("非 event 类型实体不受影响（moveEvent 只处理 event 行）", () => {
    const char = createEntity(db, { type: "character", name: "张三" });
    expect(moveEvent(db, char.id, 0, "2026-08-02T00:00:00Z")).toBeNull();
    expect(getEntity(db, char.id)).not.toBeNull(); // character 行未被触碰
  });
});

// ============ 时间标签点（G2，决策 26 修订）：listTimepoints + moveTimepoint + occurs_at 挂载 ============

describe("listTimepoints（G2 时间标签点列表，决策 26 修订）", () => {
  /** 造 n 个 timepoint，sort_order 按给定序列赋值（NULL 表示未设） */
  function seedTimepoints(names: string[], sortOrders: Array<number | null>): string[] {
    const ids: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const id = `tp-seed-${i}`;
      ids.push(id);
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
         VALUES (?, 'timepoint', ?, ?, ?, ?)`,
      ).run(id, names[i], sortOrders[i], `2026-08-0${i + 1}T00:00:00Z`, `2026-08-0${i + 1}T00:00:00Z`);
    }
    return ids;
  }

  it("恒按 sort_order 升序（NULL 沉底、id 稳定次序）；软删过滤（决策 12）", () => {
    seedTimepoints(["黄昏", "拂晓", "深夜", "正午"], [2, 0, null, 1]);
    expect(listTimepoints(db).map((r) => r.name)).toEqual(["拂晓", "正午", "黄昏", "深夜"]); // NULL 沉底
    const rows = listTimepoints(db);
    softDeleteEntity(db, rows[0].id, "2026-08-02T00:00:00Z");
    expect(listTimepoints(db).map((r) => r.name)).toEqual(["正午", "黄昏", "深夜"]); // 软删不可见
  });

  it("非 timepoint 类型不参与（与其他类型互不干扰）", () => {
    createEntity(db, { type: "event", name: "事件" });
    createEntity(db, { type: "character", name: "张三" });
    expect(listTimepoints(db)).toEqual([]);
  });
});

describe("moveTimepoint（G2，同 moveEvent 语义：全局线性序 0..n-1）", () => {
  /** 造 n 个 timepoint，sort_order 0..n-1；返回 id 数组（按序） */
  function seedTimepoints(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `tp-move-${i}`;
      ids.push(id);
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
         VALUES (?, 'timepoint', ?, ?, ?, ?)`,
      ).run(id, `时间点${i}`, i, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }
    return ids;
  }

  /** 读全部未软删 timepoint 的 id（按 sort_order 升序、NULL 沉底） */
  function timepointIdsInOrder(): string[] {
    return listTimepoints(db).map((r) => r.id);
  }

  it("顺序重排：移后重写全局线性序 0..n-1，其余相对位置保持；仅被移行刷新 updated_at", () => {
    const ids = seedTimepoints(4); // [0,1,2,3]
    // 把 id[2] 移到位置 0 → [2,0,1,3]
    expect(moveTimepoint(db, ids[2], 0, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(timepointIdsInOrder()).toEqual([ids[2], ids[0], ids[1], ids[3]]);
    // 再移 id[0] 到末尾（order 3）→ [2,1,3,0]
    expect(moveTimepoint(db, ids[0], 3, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(timepointIdsInOrder()).toEqual([ids[2], ids[1], ids[3], ids[0]]);
    // sort_order 已重写为连续 0..n-1；仅被移行 updated_at 刷新（决策 14 版本戳语义）
    const rows = db
      .prepare("SELECT id, updated_at, sort_order FROM entities WHERE type = 'timepoint'")
      .all() as Array<{ id: string; updated_at: string; sort_order: number }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids[2])!.updated_at).toBe("2026-08-02T00:00:00Z"); // 被移行：刷新
    expect(byId.get(ids[1])!.updated_at).toBe("2026-08-01T00:00:00Z"); // 未移行：不变
    expect(rows.map((r) => r.sort_order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("clamp 边界：负数 → 0；超总数 → 末尾（同 moveEvent 契约）", () => {
    const ids = seedTimepoints(3); // [0,1,2]
    expect(moveTimepoint(db, ids[2], -5, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(timepointIdsInOrder()).toEqual([ids[2], ids[0], ids[1]]); // 负数 clamp 到 0
    expect(moveTimepoint(db, ids[1], 999, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(timepointIdsInOrder()).toEqual([ids[2], ids[0], ids[1]]); // 999 → 末尾（已在末尾，序不变）
  });

  it("NULL sort_order 沉底参与排序：旧数据（迁移来的 NULL 序）可正常重排并清零", () => {
    const inserts: Array<[string, number | null]> = [
      ["tp-null-0", null],
      ["tp-null-1", null],
      ["tp-1", 1],
    ];
    for (const [id, sort] of inserts) {
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at) VALUES (?, 'timepoint', ?, ?, ?, ?)`,
      ).run(id, id, sort, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }
    // 初始：tp-1（sort=1）在前，两个 NULL 沉底（id 序）
    expect(timepointIdsInOrder()).toEqual(["tp-1", "tp-null-0", "tp-null-1"]);
    expect(moveTimepoint(db, "tp-null-0", 0, "2026-08-02T00:00:00Z")).toEqual({ moved: true });
    expect(timepointIdsInOrder()).toEqual(["tp-null-0", "tp-1", "tp-null-1"]);
    // 全部行重写为连续序（NULL 清零）
    const orders = db
      .prepare("SELECT sort_order FROM entities WHERE type = 'timepoint' ORDER BY sort_order")
      .all() as Array<{ sort_order: number }>;
    expect(orders.map((o) => o.sort_order)).toEqual([0, 1, 2]);
  });

  it("软删/不存在 → null；非 timepoint 类型不受影响", () => {
    const ids = seedTimepoints(2);
    softDeleteEntity(db, ids[0], "2026-08-02T00:00:00Z");
    expect(moveTimepoint(db, ids[0], 1, "2026-08-02T00:00:00Z")).toBeNull();
    expect(moveTimepoint(db, "tp-999", 0, "2026-08-02T00:00:00Z")).toBeNull();
    expect(timepointIdsInOrder()).toEqual([ids[1]]); // 软删行不参与排序空间
    const char = createEntity(db, { type: "character", name: "张三" });
    expect(moveTimepoint(db, char.id, 0, "2026-08-02T00:00:00Z")).toBeNull();
    expect(getEntity(db, char.id)).not.toBeNull(); // character 行未被触碰
  });
});

describe("reorderTimepoints（G2 批量重排：LLM 按时间点 name 语义排序提案确认后执行）", () => {
  /** 造 n 个 timepoint，sort_order 0..n-1；返回 id 数组（按序） */
  function seedTimepoints(n: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `tp-reorder-${i}`;
      ids.push(id);
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at)
         VALUES (?, 'timepoint', ?, ?, ?, ?)`,
      ).run(id, `时间点${i}`, i, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }
    return ids;
  }

  it("正常重排：按新序重写 sort_order 0..n-1，全部时间点 updated_at 刷新为传入时间戳（全量变化语义）", () => {
    const ids = seedTimepoints(4); // [0,1,2,3]
    const newOrder = [ids[3], ids[1], ids[0], ids[2]];
    expect(reorderTimepoints(db, newOrder, "2026-08-02T00:00:00Z")).toBe(4);
    expect(listTimepoints(db).map((r) => r.id)).toEqual(newOrder);
    // 全部时间点 updated_at 统一刷新（与 moveTimepoint 只刷单行区分——批量重排全量变化）
    const rows = db
      .prepare("SELECT id, updated_at FROM entities WHERE type = 'timepoint'")
      .all() as Array<{ id: string; updated_at: string }>;
    expect(rows.every((r) => r.updated_at === "2026-08-02T00:00:00Z")).toBe(true);
    // sort_order 列已重写为连续 0..n-1
    const orders = db
      .prepare("SELECT sort_order FROM entities WHERE type = 'timepoint' ORDER BY sort_order")
      .all() as Array<{ sort_order: number }>;
    expect(orders.map((o) => o.sort_order)).toEqual([0, 1, 2, 3]);
  });

  it("集合不一致 → 抛错且零副作用（缺时间点 / 多时间点 / 重复 id 均拒绝）", () => {
    const ids = seedTimepoints(3);
    // 缺一个时间点（LLM 幻觉漏时间点）
    expect(() => reorderTimepoints(db, [ids[2], ids[0]], "2026-08-02T00:00:00Z")).toThrow(/时间点集合与当前时间轴不一致.*缺失 1 个/);
    // 多一个不存在的 id
    expect(() => reorderTimepoints(db, [ids[2], ids[1], ids[0], "tp-999"], "2026-08-02T00:00:00Z")).toThrow(
      /时间点集合与当前时间轴不一致.*多余 1 个/,
    );
    // 重复 id
    expect(() => reorderTimepoints(db, [ids[0], ids[1], ids[0]], "2026-08-02T00:00:00Z")).toThrow(/时间点集合与当前时间轴不一致.*含重复/);
    // 零副作用：原序未被改动
    expect(listTimepoints(db).map((r) => r.id)).toEqual(ids);
  });

  it("软删时间点不参与集合（决策 12 过滤）：软删后必须从新序中剔除，否则抛错", () => {
    const ids = seedTimepoints(3);
    softDeleteEntity(db, ids[1], "2026-08-02T00:00:00Z");
    // 新序含已软删时间点 → 集合校验（软删 id 不在当前集合中）
    expect(() => reorderTimepoints(db, [ids[1], ids[0], ids[2]], "2026-08-02T00:00:00Z")).toThrow(/时间点集合与当前时间轴不一致/);
    // 按剩余未软删时间点提供新序 → 正常重排（软删行不被触碰）
    expect(reorderTimepoints(db, [ids[2], ids[0]], "2026-08-02T00:00:00Z")).toBe(2);
    expect(listTimepoints(db).map((r) => r.id)).toEqual([ids[2], ids[0]]);
    // 软删行仍保留（可回收站还原），sort_order 未被重写
    const raw = db.prepare("SELECT sort_order, deleted_at FROM entities WHERE id = ?").get(ids[1]) as {
      sort_order: number;
      deleted_at: string;
    };
    expect(raw.deleted_at).toBe("2026-08-02T00:00:00Z");
    expect(raw.sort_order).toBe(1);
  });

  it("NULL sort_order 沉底参与重排：旧数据（迁移来的 NULL 序）可整体重排并清零", () => {
    const ids: string[] = [];
    const inserts: Array<[string, number | null]> = [
      ["tp-null-0", null],
      ["tp-null-1", null],
      ["tp-1", 1],
    ];
    for (const [id, sort] of inserts) {
      ids.push(id);
      db.prepare(
        `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at) VALUES (?, 'timepoint', ?, ?, ?, ?)`,
      ).run(id, id, sort, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    }
    // 当前序（NULL 沉底）：tp-1 → tp-null-0 → tp-null-1；重排为新序
    const newOrder = [ids[1], ids[0], ids[2]];
    expect(reorderTimepoints(db, newOrder, "2026-08-02T00:00:00Z")).toBe(3);
    expect(listTimepoints(db).map((r) => r.id)).toEqual(newOrder);
    const orders = db
      .prepare("SELECT sort_order FROM entities WHERE type = 'timepoint' ORDER BY sort_order")
      .all() as Array<{ sort_order: number }>;
    expect(orders.map((o) => o.sort_order)).toEqual([0, 1, 2]); // NULL 清零
  });

  it("非 timepoint 类型实体不受影响（reorderTimepoints 只处理 timepoint 行）", () => {
    const ev = createEntity(db, { type: "event", name: "事件" });
    expect(() => reorderTimepoints(db, [ev.id], "2026-08-02T00:00:00Z")).toThrow(/时间点集合与当前时间轴不一致/);
    expect(getEntity(db, ev.id)).not.toBeNull(); // event 行未被触碰
  });
});

describe("eventOccursAt / assertEventSingleOccursAt（G2 occurs_at 1:n 挂载）", () => {
  /** 造一个 timepoint + 一条 occurs_at 挂载（target = 指定事件；deleted = 关系软删；tpId 可传以复用同一 timepoint） */
  function seedMount(eventId: string, deleted = false, tpId = `tp-mount-${eventId}`): void {
    db.prepare(
      `INSERT INTO entities (id, type, name, sort_order, created_at, updated_at) VALUES (?, 'timepoint', ?, 0, ?, ?)`,
    ).run(tpId, "第二天黄昏", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    db.prepare(
      `INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at, deleted_at)
       VALUES (?, 'timepoint', ?, 'event', ?, 'occurs_at', ?, ?, ?)`,
    ).run(`rel-mount-${eventId}`, tpId, eventId, "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z", deleted ? "2026-08-02T00:00:00Z" : null);
  }

  it("命中：返回挂载关系（source_id = timepoint id）；未挂载 → null", () => {
    const ev = createEntity(db, { type: "event", name: "藏经阁" });
    expect(eventOccursAt(db, ev.id)).toBeNull(); // 未挂载
    seedMount(ev.id);
    const rel = eventOccursAt(db, ev.id)!;
    expect(rel).toMatchObject({
      id: `rel-mount-${ev.id}`,
      source_type: "timepoint",
      source_id: `tp-mount-${ev.id}`,
      target_type: "event",
      target_id: ev.id,
      relation_type: "occurs_at",
      deleted_at: null,
    });
    // 事件的挂载与前端展示（G2.3）所需字段齐备
    expect(rel.created_at).toBe("2026-08-01T00:00:00Z");
  });

  it("关系软删 → null（决策 12 可见性）；timepoint 软删 → null（级联 + EXISTS 防御双路径）", () => {
    const ev = createEntity(db, { type: "event", name: "事件" });
    seedMount(ev.id, true); // 关系软删
    expect(eventOccursAt(db, ev.id)).toBeNull();
    // timepoint 软删（softDeleteEntity 级联软删其 occurs_at；即便级联遗漏，EXISTS 防御也兜底）
    const ev2 = createEntity(db, { type: "event", name: "事件2" });
    seedMount(ev2.id);
    softDeleteEntity(db, `tp-mount-${ev2.id}`, "2026-08-02T00:00:00Z");
    expect(eventOccursAt(db, ev2.id)).toBeNull();
  });

  it("assertEventSingleOccursAt：未挂载通过（无副作用）；已挂载抛 RelationError（EVENT_ALREADY_MOUNTED）", () => {
    const ev = createEntity(db, { type: "event", name: "事件" });
    expect(() => assertEventSingleOccursAt(db, ev.id)).not.toThrow(); // 未挂载 → 放行
    seedMount(ev.id);
    try {
      assertEventSingleOccursAt(db, ev.id);
      expect.unreachable("已挂载应抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(RelationError);
      expect((err as RelationError).code).toBe("EVENT_ALREADY_MOUNTED");
      expect((err as Error).message).toContain("重复挂载拒绝");
    }
  });

  it("仅 occurs_at 视为挂载：其他关系类型（appears_in 等）不干扰", () => {
    const ev = createEntity(db, { type: "event", name: "事件" });
    db.prepare(
      "INSERT INTO relation_records (id, source_type, source_id, target_type, target_id, relation_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("rel-other", "character", "char-seed", "event", ev.id, "appears_in", "2026-08-01T00:00:00Z", "2026-08-01T00:00:00Z");
    expect(eventOccursAt(db, ev.id)).toBeNull();
    expect(() => assertEventSingleOccursAt(db, ev.id)).not.toThrow();
  });
});
