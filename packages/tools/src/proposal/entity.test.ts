// S6.6 提案类工具测试：实体（propose_create/update/delete_entity）
// 覆盖：tool_result 仅 { proposal_id(prop_ 前缀), summary } 无预览细节（2026-08 修订）/
//   **不落盘**（调用后实体零变化——与 S6.7 执行工具对比的核心差异）/
//   引用不存在/已软删抛错（决策 12/14）/ signal aborted（AbortedError）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, getEntity, listEntities, openDatabase, softDeleteEntity, type Db } from "@whispering233/ai-editor-db";
import { AbortedError } from "../analysis/utils.js";
import {
  buildProposeDeleteEntity,
  buildProposeUpdateEntity,
  runProposeCreateEntity,
  runProposeDeleteEntity,
  runProposeUpdateEntity,
} from "./entity.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-entity-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("propose_create_entity", () => {
  it("tool_result 仅 { proposal_id, summary }：prop_ 前缀 + 一句话摘要，无预览细节", () => {
    const result = runProposeCreateEntity(makeCtx(), { type: "character", name: "阿强", data: { role: "主角" } });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]); // 不含 preview/diff 等预览字段
    expect(result.proposal_id.startsWith("prop_")).toBe(true);
    expect(result.summary).toBe("创建实体「阿强」（character）");
  });

  it("不落盘：调用后实体表零新增（S6.7 对比核心差异）", () => {
    runProposeCreateEntity(makeCtx(), { type: "character", name: "阿强", data: { role: "主角" } });
    expect(listEntities(db, { type: "character", limit: 200 }).items).toHaveLength(0);
    expect(listEntities(db, { limit: 200 }).total).toBe(0);
  });
});

describe("propose_update_entity", () => {
  it("完整提案结构：type/args/project_id/引用快照（实体自身 updated_at，决策 14）/summary", () => {
    const row = createEntity(db, { type: "character", name: "阿强", data: { status: "alive" } });
    const proposal = buildProposeUpdateEntity(makeCtx(), { entity_id: row.id, patches: { status: "dead" } });
    expect(proposal.type).toBe("propose_update_entity");
    expect(proposal.args).toEqual({ entity_id: row.id, patches: { status: "dead" } });
    expect(proposal.project_id).toBe("proj-test");
    expect(proposal.references).toEqual([{ kind: "entity", id: row.id, updated_at: row.updated_at }]);
    expect(proposal.summary).toContain("更新实体「阿强」的 1 个字段");
  });

  it("返回 { proposal_id, summary }，引用快照取实体自身 updated_at（决策 14）", () => {
    const row = createEntity(db, { type: "character", name: "阿强", data: { status: "alive" } });
    const result = runProposeUpdateEntity(makeCtx(), { entity_id: row.id, patches: { status: "dead" } });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain("更新实体「阿强」的 1 个字段");
    // 快照语义：软删/编辑会更新 updated_at（决策 12 修订），此处实体未动，快照即创建时刻
    const fresh = getEntity(db, row.id)!;
    expect(fresh.updated_at).toBe(row.updated_at);
  });

  it("不落盘：调用后实体 data 不变", () => {
    const row = createEntity(db, { type: "character", name: "阿强", data: { status: "alive" } });
    runProposeUpdateEntity(makeCtx(), { entity_id: row.id, patches: { status: "dead", role: "主角" } });
    const fresh = getEntity(db, row.id)!;
    expect(fresh.data).toEqual({ status: "alive" }); // patches 未写入
    expect(fresh.updated_at).toBe(row.updated_at);
  });

  it("引用不存在 / 已软删 → 抛错（决策 12 修订）", () => {
    expect(() => runProposeUpdateEntity(makeCtx(), { entity_id: "char-999", patches: { status: "dead" } })).toThrow(
      /实体不存在或已软删: char-999/,
    );
    const row = createEntity(db, { type: "character", name: "阿强" });
    softDeleteEntity(db, row.id, T0);
    expect(() => runProposeUpdateEntity(makeCtx(), { entity_id: row.id, patches: { status: "dead" } })).toThrow(
      /实体不存在或已软删/,
    );
  });
});

describe("propose_delete_entity", () => {
  it("完整提案结构：引用为实体自身 updated_at；tool_result 无预览", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    const proposal = buildProposeDeleteEntity(makeCtx(), { entity_id: row.id });
    expect(proposal.references).toEqual([{ kind: "entity", id: row.id, updated_at: row.updated_at }]);
    expect(proposal.args).toEqual({ entity_id: row.id });
    const result = runProposeDeleteEntity(makeCtx(), { entity_id: row.id });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain("删除实体「阿强」");
  });

  it("返回 { proposal_id, summary }，不落盘：实体仍存在且未软删", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    const result = runProposeDeleteEntity(makeCtx(), { entity_id: row.id });
    expect(result.summary).toContain("删除实体「阿强」");
    const fresh = getEntity(db, row.id)!;
    expect(fresh).not.toBeNull();
    expect(fresh.deleted_at).toBeNull(); // 未被软删
  });

  it("引用不存在 / 已软删 → 抛错", () => {
    expect(() => runProposeDeleteEntity(makeCtx(), { entity_id: "char-999" })).toThrow(/实体不存在或已软删/);
    const row = createEntity(db, { type: "character", name: "阿强" });
    softDeleteEntity(db, row.id, T0);
    expect(() => runProposeDeleteEntity(makeCtx(), { entity_id: row.id })).toThrow(/实体不存在或已软删/);
  });
});

describe("signal aborted（决策 16 ③）", () => {
  it("三个实体提案工具在 signal 已中止时抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx();
    expect(() => runProposeCreateEntity(ctx, { type: "character", name: "阿强" }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeUpdateEntity(ctx, { entity_id: "char-1", patches: { status: "dead" } }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeDeleteEntity(ctx, { entity_id: "char-1" }, controller.signal)).toThrow(AbortedError);
  });
});
