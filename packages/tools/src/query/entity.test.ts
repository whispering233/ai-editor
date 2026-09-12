// S6.3 查询工具测试：get_entity / search_entities / get_entity_summary
// 覆盖：详情返回（data 解析）/ type 不一致 → null / 软删不可见/
// search filters（status/tags）/ 摘要结构（character→role/status）/ 聚合统计分布与软删不计入
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createEntity, softDeleteEntity } from "@whispering233/ai-editor-db";
import { runGetEntity, runGetEntitySummary, runSearchEntities } from "./entity.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-entity-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 工具上下文（outlineDir 本组测试用不到实体关系，仍按真实形态构造） */
function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("get_entity", () => {
  it("返回实体详情：data JSON 解析后的字段完整呈现（camelCase API 形态）", () => {
    const row = createEntity(db, {
      type: "character",
      name: "阿强",
      data: { role: "主角", status: "alive", abilities: ["剑术"], custom_fields: { 门派: "青城" } },
    });
    const result = runGetEntity(makeCtx(), { type: "character", id: row.id });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(row.id);
    expect(result!.type).toBe("character");
    expect(result!.name).toBe("阿强");
    expect(result!.data).toEqual({
      role: "主角",
      status: "alive",
      abilities: ["剑术"],
      custom_fields: { 门派: "青城" },
    });
    expect(Number.isNaN(Date.parse(result!.createdAt))).toBe(false);
  });

  it("type 与实体实际类型不一致 → null（参数错误，防脏数据）", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    expect(runGetEntity(makeCtx(), { type: "setting", id: row.id })).toBeNull();
  });

  it("不存在 → null；已软删 → null（回收站对象不可见）", () => {
    expect(runGetEntity(makeCtx(), { type: "character", id: "char-999" })).toBeNull();
    const row = createEntity(db, { type: "character", name: "阿强" });
    softDeleteEntity(db, row.id, T0);
    expect(runGetEntity(makeCtx(), { type: "character", id: row.id })).toBeNull();
  });
});

describe("search_entities", () => {
  function seedSearch(): { charA: string; charB: string; charC: string } {
    const a = createEntity(db, {
      type: "character",
      name: "阿强",
      data: { role: "主角", status: "alive", tags: ["门派甲", "主世界"] },
    });
    const b = createEntity(db, {
      type: "character",
      name: "阿珍",
      data: { role: "配角", status: "alive", tags: ["门派甲"] },
    });
    const c = createEntity(db, {
      type: "character",
      name: "阿强二号",
      data: { role: "龙套", status: "dead", tags: [] },
    });
    return { charA: a.id, charB: b.id, charC: c.id };
  }

  it("名称模糊匹配 + 摘要结构（character → role；2026-09 卡片 2.1：status 不再进摘要）", () => {
    const { charA, charB, charC } = seedSearch();
    const result = runSearchEntities(makeCtx(), { type: "character", query: "阿强" });
    expect(result.items.map((i) => i.id).sort()).toEqual([charA, charC].sort());
    expect(result.total).toBe(2);
    const byId = new Map(result.items.map((i) => [i.id, i]));
 // 种子里的 status 只是旧数据残留（.passthrough 容错）——摘要不再提取它
    expect(byId.get(charA)!.summary).toEqual({ role: "主角" });
    expect(byId.get(charB)).toBeUndefined();
  });

  it("filters.status 精确匹配 data.status", () => {
    seedSearch();
    const alive = runSearchEntities(makeCtx(), { type: "character", query: "阿", filters: { status: "alive" } });
    expect(alive.items.map((i) => i.name).sort()).toEqual(["阿强", "阿珍"]);
    const dead = runSearchEntities(makeCtx(), { type: "character", query: "阿", filters: { status: "dead" } });
    expect(dead.items.map((i) => i.name)).toEqual(["阿强二号"]);
  });

  it("filters.tags 要求 data.tags 包含全部指定标签（AND）；tags 非数组/缺标签不匹配", () => {
    seedSearch();
    const r1 = runSearchEntities(makeCtx(), { type: "character", query: "阿", filters: { tags: ["门派甲"] } });
    expect(r1.items.map((i) => i.name).sort()).toEqual(["阿强", "阿珍"]);
    const r2 = runSearchEntities(makeCtx(), {
      type: "character",
      query: "阿",
      filters: { tags: ["门派甲", "主世界"] },
    });
    expect(r2.items.map((i) => i.name)).toEqual(["阿强"]);
    const r3 = runSearchEntities(makeCtx(), {
      type: "character",
      query: "阿",
      filters: { tags: ["不存在标签"] },
    });
    expect(r3.items).toEqual([]);
  });

  it("软删实体不可见", () => {
    const { charA } = seedSearch();
    softDeleteEntity(db, charA, T0);
    const result = runSearchEntities(makeCtx(), { type: "character", query: "阿" });
    expect(result.items.map((i) => i.id)).not.toContain(charA);
  });

  it("limit 传 200（db clamp 上限）：超过默认 50 条时全量返回", () => {
 // 插入 60 条同名前缀实体（name 均含「批量」）；默认 listEntities limit 50 会截断
    for (let i = 0; i < 60; i++) {
      createEntity(db, { type: "character", name: `批量角色${i}` });
    }
    const result = runSearchEntities(makeCtx(), { type: "character", query: "批量" });
    expect(result.total).toBe(60);
    expect(result.items).toHaveLength(60); // limit 200 生效（非默认 50）
  });

  it("status 匹配摘要层与 data 层一致（hook → status/payoff_timing 摘要）", () => {
    createEntity(db, { type: "hook", name: "密信", data: { status: "planted", payoff_timing: "chapter" } });
    createEntity(db, { type: "hook", name: "遗物", data: { status: "resolved", payoff_timing: "book" } });
    const result = runSearchEntities(makeCtx(), { type: "hook", query: "", filters: { status: "planted" } });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("密信");
    expect(result.items[0].summary).toEqual({ status: "planted", payoff_timing: "chapter" });
  });
});

describe("get_entity_summary", () => {
  it("character：total/byRole/topAbilities（面板顶层分组名；软删不计入）", () => {
    createEntity(db, {
      type: "character",
      name: "阿强",
      data: {
        role: "主角",
        ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }, { name: "剑术" }],
      },
    });
    createEntity(db, {
      type: "character",
      name: "阿珍",
      data: { role: "配角", ability_panel: [{ name: "火系" }, { name: "水系" }] },
    });
    const dead = createEntity(db, {
      type: "character",
      name: "阿灭",
      data: { role: "反派", ability_panel: [{ name: "毒术" }] },
    });
    softDeleteEntity(db, dead.id, T0); // 软删不计入统计

    const result = runGetEntitySummary(makeCtx(), { type: "character" });
    expect(result.total).toBe(2);
    expect(result.byRole).toEqual({ 主角: 1, 配角: 1 });
 // 卡片 2.2：character 不再输出 byStatus（status 字段已移除）
    expect(result.byStatus).toBeUndefined();
 // 顶层分组名跨角色累加；同频按名称序
    expect(result.topAbilities).toEqual([
      { ability: "火系", count: 2 },
      { ability: "剑术", count: 1 },
      { ability: "水系", count: 1 },
    ]);
  });

  it("hook：byStatus/byPayoffTiming；无能力/角色字段", () => {
    createEntity(db, { type: "hook", name: "密信", data: { status: "planted", payoff_timing: "chapter" } });
    createEntity(db, { type: "hook", name: "遗物", data: { status: "planted", payoff_timing: "book" } });
    const result = runGetEntitySummary(makeCtx(), { type: "hook" });
    expect(result.total).toBe(2);
    expect(result.byStatus).toEqual({ planted: 2 });
    expect(result.byPayoffTiming).toEqual({ chapter: 1, book: 1 });
    expect(result.byRole).toBeUndefined();
    expect(result.topAbilities).toBeUndefined();
  });

  it("setting：byTags（K2：data.tags）；location：byType", () => {
    createEntity(db, { type: "setting", name: "修真界", data: { tags: ["世界观"] } });
    createEntity(db, { type: "setting", name: "江湖", data: { tags: ["世界观"] } });
    createEntity(db, { type: "setting", name: "门派", data: { tags: ["组织"] } });
    expect(runGetEntitySummary(makeCtx(), { type: "setting" })).toEqual({
      type: "setting",
      total: 3,
      byTags: { 世界观: 2, 组织: 1 },
    });

    createEntity(db, { type: "location", name: "青城山", data: { type: "山门" } });
    createEntity(db, { type: "location", name: "藏经阁", data: { type: "建筑" } });
    expect(runGetEntitySummary(makeCtx(), { type: "location" })).toEqual({
      type: "location",
      total: 2,
      byType: { 山门: 1, 建筑: 1 },
    });
  });

  it("空类型：total 0，分布字段为空对象", () => {
    const result = runGetEntitySummary(makeCtx(), { type: "character" });
    expect(result).toEqual({ type: "character", total: 0, byRole: {}, topAbilities: [] });
  });
});
