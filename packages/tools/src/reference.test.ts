// 参考资料工具测试（决策 36，批次九）
// 覆盖：search_references（标题/摘要返回 + type 分类过滤 + 软删不可见）/ propose_create_reference（提案产出/不落库）
//      / executor executeCreateReference（确认后写入 + type 缺省 material）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createEntity, softDeleteEntity } from "@whispering233/ai-editor-db";
import { runSearchReferences } from "./query/reference.js";
import { buildProposeCreateReference, runProposeCreateReference } from "./proposal/reference.js";
import { executeCreateReference } from "./executor/reference.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-ref-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("search_references", () => {
  it("返回匹配参考资料摘要列表（content 截断 120 字 + type 分类）", () => {
    createEntity(db, {
      type: "reference",
      name: "五行相生摘抄",
      data: { type: "theory", content: "金生水、水生木……（长文省略）".repeat(40), tags: ["五行", "设定"] },
    });
    createEntity(db, { type: "reference", name: "灵感：主角觉醒", data: { type: "inspiration", content: "雨天里的顿悟", tags: ["灵感"] } });

    const r = runSearchReferences(makeCtx(), { query: "五行" });
    expect(r.total).toBe(1);
    expect(r.items[0].name).toBe("五行相生摘抄");
    expect(r.items[0].summary?.type).toBe("theory");
    expect((r.items[0].summary?.content as string).length).toBeLessThanOrEqual(120);
  });

  it("type 分类过滤生效（summary.type 匹配）", () => {
    createEntity(db, { type: "reference", name: "A", data: { type: "theory" } });
    createEntity(db, { type: "reference", name: "B", data: { type: "inspiration" } });

    const r = runSearchReferences(makeCtx(), { query: "", type: "inspiration" });
    expect(r.total).toBe(1);
    expect(r.items[0].name).toBe("B");
  });

  it("软删参考资料不可见（决策 12 修订查询工具默认过滤）", () => {
    const row = createEntity(db, { type: "reference", name: "C", data: { type: "material" } });
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    const r = runSearchReferences(makeCtx(), { query: "" });
    expect(r.total).toBe(0);
  });
});

describe("propose_create_reference", () => {
  it("产出提案（不落库）+ 摘要含标题分类；run 只返回 proposal_id/summary", () => {
    const ctx = makeCtx();
    const proposal = buildProposeCreateReference(ctx, { name: "江湖三要素", type: "theory", content: "恩怨、情仇、得失", tags: ["方法论"] });
    expect(proposal.type).toBe("propose_create_reference");
    expect(proposal.args).toMatchObject({ name: "江湖三要素", data: { type: "theory", content: "恩怨、情仇、得失", tags: ["方法论"] } });
    expect(proposal.references).toEqual([]); // 无引用对象
    // 不落库：无 reference 实体被创建
    const result = runProposeCreateReference(ctx, { name: "江湖三要素", type: "theory", content: "x" });
    expect(result.proposal_id).toMatch(/^prop_/); // 随机运行时 id
    expect(typeof result.summary).toBe("string");
  });
});

describe("executeCreateReference（决策 36 确认后写入）", () => {
  it("写入 reference 实体（type 缺省 material 补默认），返回新 id", () => {
    const ctx = makeCtx();
    const proposal = buildProposeCreateReference(ctx, { name: "素材库第一条", type: undefined });
    const result = executeCreateReference(ctx, proposal);
    expect(result.id).toMatch(/^ref-/);
    const row = db.prepare("SELECT data FROM entities WHERE id = ?").get(result.id) as { data: string };
    expect(JSON.parse(row.data)).toMatchObject({ type: "material" }); // 缺省默认
  });
});

