// S6.6 提案类工具测试：关系（propose_add/remove_relation）
// 覆盖：tool_result 仅 { proposal_id, summary } 无预览 / args 规范化执行形态
//   （端点类型生成时自动识别，S6.7 直接消费）/ 引用快照（实体自身 / 节点级 updated_at，
//   决策 14/19）/ **不落盘**（关系表零变化）/ 端点不存在/软删、关系不可见抛错（决策 12）/
//   signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, createRelation, getRelation, listRelations, openDatabase, softDeleteEntity, type Db } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@ai-editor/db";
import { AbortedError } from "../analysis/utils.js";
import { buildProposeAddRelation, buildProposeRemoveRelation, runProposeAddRelation, runProposeRemoveRelation } from "./relation.js";
import { refOutlineNode } from "./types.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-relation-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一,场景二]] 的大纲树 */
function seedOutlineTree(): OutlineFileTree {
  return {
    id: "root",
    type: "root",
    schema_version: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updated_at: T0,
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updated_at: T0,
            children: [
              { id: "sc-1", type: "scene", title: "场景一", updated_at: T0 },
            ],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("propose_add_relation", () => {
  it("实体↔实体：args 规范化为执行形态（source_type/source_id/...），引用快照为两端实体 updated_at", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const result = runProposeAddRelation(makeCtx(), { source: a.id, target: b.id, type: "ally" });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]); // 无预览细节
    expect(result.summary).toBe(`新增关系: ${a.id} —ally→ ${b.id}`);
    // 完整提案对象（build 纯产出）：args 为执行形态 + references 快照（决策 14）
    const proposal = buildProposeAddRelation(makeCtx(), { source: a.id, target: b.id, type: "ally" });
    expect(proposal.type).toBe("propose_add_relation");
    expect(proposal.project_id).toBe("proj-test");
    expect(proposal.args).toEqual({
      source_type: "character",
      source_id: a.id,
      target_type: "character",
      target_id: b.id,
      relation_type: "ally",
    });
    expect(proposal.references).toEqual([
      { kind: "entity", id: a.id, updated_at: a.updated_at },
      { kind: "entity", id: b.id, updated_at: b.updated_at },
    ]);
  });

  it("大纲节点端点：自动识别为 outline_node，引用为节点级 updated_at（决策 19）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    const result = runProposeAddRelation(makeCtx(), { source: char.id, target: "sc-1", type: "appears_in" });
    expect(result.summary).toBe(`新增关系: ${char.id} —appears_in→ sc-1`);
    const node = findOutlineNode(readOutlineFile(dir), "sc-1")!;
    expect(refOutlineNode(node)).toEqual({ kind: "outline_node", id: "sc-1", updated_at: T0 });
  });

  it("metadata 透传进执行参数", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const result = runProposeAddRelation(makeCtx(), { source: a.id, target: b.id, type: "ally", metadata: { since: 3 } });
    expect(result.proposal_id.startsWith("prop_")).toBe(true);
  });

  it("不落盘：调用后关系表零新增（S6.7 对比核心差异）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    runProposeAddRelation(makeCtx(), { source: a.id, target: b.id, type: "ally" });
    expect(listRelations(db, {}, 3, dir).relations).toHaveLength(0);
  });

  it("端点不存在 / root / 已软删 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const a = createEntity(db, { type: "character", name: "甲" });
    expect(() => runProposeAddRelation(makeCtx(), { source: a.id, target: "char-999", type: "ally" })).toThrow(/端点不存在或已软删/);
    expect(() => runProposeAddRelation(makeCtx(), { source: "root", target: a.id, type: "ally" })).toThrow(/端点不存在或已软删/);
    softDeleteEntity(db, a.id, T0);
    expect(() => runProposeAddRelation(makeCtx(), { source: a.id, target: a.id, type: "ally" })).toThrow(/端点不存在或已软删/);
  });
});

describe("propose_remove_relation", () => {
  it("返回 { proposal_id, summary }；完整提案引用快照为关系自身 updated_at（决策 14）", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const rel = createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    const result = runProposeRemoveRelation(makeCtx(), { relation_id: rel.id });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain(`移除关系 character/${a.id} —ally→ character/${b.id}`);
    const proposal = buildProposeRemoveRelation(makeCtx(), { relation_id: rel.id });
    expect(proposal.references).toEqual([{ kind: "relation", id: rel.id, updated_at: rel.updated_at }]);
    expect(proposal.args).toEqual({ relation_id: rel.id });
  });

  it("不落盘：调用后关系仍存在且未删（决策 12：手动删才物理删，提案不删）", () => {
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const rel = createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    runProposeRemoveRelation(makeCtx(), { relation_id: rel.id });
    expect(getRelation(db, rel.id, dir)).not.toBeNull();
  });

  it("关系不存在 / 端点软删不可见 → 抛错（决策 12 修订）", () => {
    expect(() => runProposeRemoveRelation(makeCtx(), { relation_id: "rel-999" })).toThrow(/关系不存在或不可见/);
    const a = createEntity(db, { type: "character", name: "甲" });
    const b = createEntity(db, { type: "character", name: "乙" });
    const rel = createRelation(db, { sourceType: "character", sourceId: a.id, targetType: "character", targetId: b.id, relationType: "ally" }, dir);
    softDeleteEntity(db, a.id, T0); // 端点软删 → 关系不可见（级联软删使 getRelation 返回 null）
    expect(() => runProposeRemoveRelation(makeCtx(), { relation_id: rel.id })).toThrow(/关系不存在或不可见/);
  });
});

describe("signal aborted（决策 16 ③）", () => {
  it("关系提案工具在 signal 已中止时抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx();
    expect(() => runProposeAddRelation(ctx, { source: "char-1", target: "char-2", type: "ally" }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeRemoveRelation(ctx, { relation_id: "rel-1" }, controller.signal)).toThrow(AbortedError);
  });
});
