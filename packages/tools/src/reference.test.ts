// 参考资料工具测试
// 覆盖：search_references（标题/摘要返回 + type 分类过滤 + 软删不可见）/ get_entity 的 reference 分支
// （附 content = 投影文本，无块 JSON 片段）/ propose_create_reference（提案产出/不落库）
// / executor executeCreateReference（确认后写入参考实体 + 正文文档行（卡 12.9））
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createEntity, softDeleteEntity, upsertDocument } from "@whispering233/ai-editor-db";
import { runGetEntity } from "./query/entity.js";
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
 // 卡 12.7a：正文真相在 document_records（data.content 不再被读）——摘要 content = content_text 投影
    const row = createEntity(db, {
      type: "reference",
      name: "五行相生摘抄",
      data: { type: "theory", tags: ["五行", "设定"] },
    });
    upsertDocument(db, {
      ownerKind: "reference",
      ownerId: row.id,
      content: "[]",
      contentText: "金生水、水生木……（长文省略）".repeat(40),
      now: "2026-08-01T00:00:00Z",
    });
    createEntity(db, { type: "reference", name: "灵感：主角觉醒", data: { type: "inspiration", tags: ["灵感"] } });

    const r = runSearchReferences(makeCtx(), { query: "五行" });
    expect(r.total).toBe(1);
    expect(r.items[0].name).toBe("五行相生摘抄");
    expect(r.items[0].summary?.type).toBe("theory");
    expect((r.items[0].summary?.content as string).length).toBeLessThanOrEqual(120);
 // 摘要来源 = 文档表投影（卡 12.9 核对；data.content 已不在读路径上）
    expect(r.items[0].summary?.content).toBe(("金生水、水生木……（长文省略）".repeat(40)).slice(0, 120));
  });

  it("type 分类过滤生效（summary.type 匹配）", () => {
    createEntity(db, { type: "reference", name: "A", data: { type: "theory" } });
    createEntity(db, { type: "reference", name: "B", data: { type: "inspiration" } });

    const r = runSearchReferences(makeCtx(), { query: "", type: "inspiration" });
    expect(r.total).toBe(1);
    expect(r.items[0].name).toBe("B");
  });

  it("软删参考资料不可见（查询工具默认过滤）", () => {
    const row = createEntity(db, { type: "reference", name: "C", data: { type: "material" } });
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    const r = runSearchReferences(makeCtx(), { query: "" });
    expect(r.total).toBe(0);
  });
});

describe("get_entity（reference 分支：卡 12.9）", () => {
  it("返回投影文本 content（非块 JSON 原文）；未写过正文 → 空串", () => {
    const withDoc = createEntity(db, { type: "reference", name: "五行摘抄", data: { type: "theory" } });
    upsertDocument(db, {
      ownerKind: "reference",
      ownerId: withDoc.id,
      content: JSON.stringify([
        { id: "r1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "五行摘抄" }] },
        { id: "r2", type: "paragraph", content: [{ type: "text", text: "木曰曲直" }] },
      ]),
      contentText: "## 五行摘抄\n\n木曰曲直",
      now: "2026-08-01T00:00:00Z",
    });
    const found = runGetEntity(makeCtx(), { type: "reference", id: withDoc.id });
    expect(found!.content).toBe("## 五行摘抄\n\n木曰曲直");
 // 响应里不得出现块 JSON 片段（块体只服务编辑器，不进模型上下文）
    const serialized = JSON.stringify(found);
    expect(serialized).not.toContain("paragraph");
    expect(serialized).not.toContain("text\":");

    const withoutDoc = createEntity(db, { type: "reference", name: "空条目" });
    expect(runGetEntity(makeCtx(), { type: "reference", id: withoutDoc.id })!.content).toBe("");
  });

  it("非 reference 类型不携带 content 字段（稀疏语义）", () => {
    const character = createEntity(db, { type: "character", name: "阿强" });
    expect("content" in runGetEntity(makeCtx(), { type: "character", id: character.id })!).toBe(false);
  });

  it("软删 / 不存在 → null（正文也不返回）", () => {
    const row = createEntity(db, { type: "reference", name: "待删" });
    softDeleteEntity(db, row.id, "2026-08-02T00:00:00Z");
    expect(runGetEntity(makeCtx(), { type: "reference", id: row.id })).toBeNull();
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

describe("executeCreateReference（确认后写入）", () => {
  /** 直查实体行 data（绕过端点自说自话） */
  function entityData(id: string): Record<string, unknown> {
    const row = db.prepare("SELECT data FROM entities WHERE id = ?").get(id) as { data: string };
    return JSON.parse(row.data) as Record<string, unknown>;
  }

  /** 直查文档行（owner_kind='reference'） */
  function docRow(id: string): { content: string; content_text: string } | undefined {
    return db
      .prepare("SELECT content, content_text FROM document_records WHERE owner_kind = 'reference' AND owner_id = ?")
      .get(id) as { content: string; content_text: string } | undefined;
  }

  it("纯文本摘录 → 段落块数组 + content_text = 块投影；entities.data 无 content（直查 SQLite）", () => {
    const ctx = makeCtx();
    const proposal = buildProposeCreateReference(ctx, {
      name: "素材库第一条",
      type: "摘抄",
      content: "第一行摘录\n\n第三行摘录",
      source: "https://example.com/a",
      tags: ["五行"],
    });
    const result = executeCreateReference(ctx, proposal);
    expect(result.id).toMatch(/^ref-/);

    expect(entityData(result.id!)).toEqual({ type: "摘抄", url: "https://example.com/a", tags: ["五行"] });
    const doc = docRow(result.id!);
    expect(doc).toBeDefined();
    expect(doc!.content_text).toBe("第一行摘录\n\n第三行摘录");
    const blocks = JSON.parse(doc!.content) as Array<{ type: string; content: Array<{ text: string }> }>;
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(blocks.map((b) => b.content.map((t) => t.text).join("")).join("\n")).toBe(doc!.content_text);
  });

  it("content_text 从块重算（不是提交原文）：单换行 → 空行分隔两段；单行原样", () => {
    const ctx = makeCtx();
    const twoLines = executeCreateReference(
      ctx,
      buildProposeCreateReference(ctx, { name: "两段摘录", content: "第一行\n第二行" }),
    );
    // 提交是单换行，投影是块间空行（与编辑器所见一致）；直落原文会让 AI 读到的文本与块投影不一致
    expect(docRow(twoLines.id!)!.content_text).toBe("第一行\n\n第二行");

    const single = executeCreateReference(
      ctx,
      buildProposeCreateReference(ctx, { name: "单行摘录", content: "单行" }),
    );
    expect(docRow(single.id!)!.content_text).toBe("单行");
  });

  it("未携带 content：实体照建、不落文档行（先建条目后写正文）；type 缺省 material", () => {
    const ctx = makeCtx();
    const proposal = buildProposeCreateReference(ctx, { name: "素材库第二条", type: undefined });
    const result = executeCreateReference(ctx, proposal);
    expect(result.id).toMatch(/^ref-/);
    expect(entityData(result.id!)).toEqual({ type: "material" }); // 缺省默认，且无遗留 content 键
    expect(docRow(result.id!)).toBeUndefined();
  });
});

