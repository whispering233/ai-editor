// S6.6 提案公共层测试：提案对象结构（buildProposal）+ 端点/节点/伏笔解析辅助
// 覆盖：proposal_id prop_ 前缀 / type/args/project_id/references 快照/summary/createdAt 结构完整、
//   refEntity/refRelation/refOutlineNode 快照取值（决策 14/19）、resolveEndpoint 实体/大纲节点
//   识别与软删拒绝（决策 12）、requireOutlineNode/requireHook 类型一致性、signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, createRelation, openDatabase, softDeleteEntity, type Db } from "@ai-editor/db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@ai-editor/db";
import { AbortedError } from "../analysis/utils.js";
import {
  buildProposal,
  checkProposalAborted,
  refEntity,
  refOutlineNode,
  refRelation,
  requireHook,
  requireOutlineNode,
  resolveEndpoint,
  type ProposalReference,
} from "./types.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-types-"));
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
              { id: "sc-2", type: "scene", title: "场景二", updated_at: T0 },
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

/** 直接改 outline.json 软删指定节点（db 无大纲软删 API，测试直写） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

const sampleRefs: ProposalReference[] = [
  { kind: "entity", id: "char-1", updated_at: T0 },
  { kind: "outline_node", id: "ch-1", updated_at: T0 },
];

describe("buildProposal（提案对象结构，决策 14）", () => {
  it("结构完整：proposal_id prop_ 前缀 + type/args/project_id/references/summary/createdAt", () => {
    const ctx = makeCtx();
    const proposal = buildProposal(ctx, "propose_update_entity", { entity_id: "char-1", patches: { status: "dead" } }, sampleRefs, "更新实体「阿强」的 1 个字段");
    expect(proposal.proposal_id.startsWith("prop_")).toBe(true);
    expect(proposal.type).toBe("propose_update_entity");
    expect(proposal.args).toEqual({ entity_id: "char-1", patches: { status: "dead" } });
    expect(proposal.project_id).toBe("proj-test"); // 项目绑定（决策 14 修订）
    expect(proposal.references).toEqual(sampleRefs); // 引用快照原样携带
    expect(proposal.summary).toBe("更新实体「阿强」的 1 个字段");
    expect(Number.isNaN(Date.parse(proposal.createdAt))).toBe(false); // ISO 8601（应用层写入约定）
  });

  it("proposal_id 每次生成唯一（prop_ 前缀 + nanoid）", () => {
    const a = buildProposal(makeCtx(), "propose_delete_entity", { entity_id: "char-1" }, [], "s");
    const b = buildProposal(makeCtx(), "propose_delete_entity", { entity_id: "char-1" }, [], "s");
    expect(a.proposal_id).not.toBe(b.proposal_id);
  });
});

describe("引用快照辅助（决策 14/19）", () => {
  it("refEntity 用实体自身 updated_at", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    expect(refEntity(row)).toEqual({ kind: "entity", id: row.id, updated_at: row.updated_at });
  });

  it("refOutlineNode 用节点级 updated_at（决策 19）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const node = findOutlineNode(readOutlineFile(dir), "ch-1")!;
    expect(refOutlineNode(node)).toEqual({ kind: "outline_node", id: "ch-1", updated_at: T0 });
  });

  it("refRelation 用关系自身 updated_at", () => {
    const row = createEntity(db, { type: "character", name: "甲" });
    const row2 = createEntity(db, { type: "character", name: "乙" });
    const rel = createRelation(db, { sourceType: "character", sourceId: row.id, targetType: "character", targetId: row2.id, relationType: "ally" }, dir);
    expect(refRelation(rel)).toEqual({ kind: "relation", id: rel.id, updated_at: rel.updated_at });
  });
});

describe("resolveEndpoint（端点识别，决策 12 修订）", () => {
  it("实体 id → 实体类型 + 实体快照", () => {
    const row = createEntity(db, { type: "character", name: "阿强" });
    const resolved = resolveEndpoint(makeCtx(), row.id);
    expect(resolved.type).toBe("character");
    expect(resolved.ref).toEqual({ kind: "entity", id: row.id, updated_at: row.updated_at });
  });

  it("大纲节点 id → outline_node 类型 + 节点级快照", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const resolved = resolveEndpoint(makeCtx(), "ch-1");
    expect(resolved.type).toBe("outline_node");
    expect(resolved.ref).toEqual({ kind: "outline_node", id: "ch-1", updated_at: T0 });
  });

  it("不存在 / root / 已软删实体 / 已软删节点 → 抛错", () => {
    expect(() => resolveEndpoint(makeCtx(), "char-999")).toThrow(/不存在或已软删/);
    expect(() => resolveEndpoint(makeCtx(), "root")).toThrow(/不存在或已软删/);
    const row = createEntity(db, { type: "character", name: "阿强" });
    softDeleteEntity(db, row.id, T0);
    expect(() => resolveEndpoint(makeCtx(), row.id)).toThrow(/不存在或已软删/);
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("ch-1");
    expect(() => resolveEndpoint(makeCtx(), "ch-1")).toThrow(/不存在或已软删/);
  });
});

describe("requireOutlineNode（触发节点/父节点校验）", () => {
  it("存在且未软删 → 返回节点", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const node = requireOutlineNode(makeCtx(), "sc-1");
    expect(node.title).toBe("场景一");
  });

  it("不存在 / 已软删 → 抛错", () => {
    expect(() => requireOutlineNode(makeCtx(), "sc-999")).toThrow(/大纲节点不存在或已软删/);
    writeOutlineFile(dir, seedOutlineTree());
    softDeleteNode("vol-1");
    expect(() => requireOutlineNode(makeCtx(), "vol-1")).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("requireHook（伏笔类型一致性校验）", () => {
  it("type=hook 实体 → 返回实体行", () => {
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    const row = requireHook(makeCtx(), hook.id);
    expect(row.type).toBe("hook");
    expect(row.name).toBe("身世之谜");
  });

  it("非 hook 实体（类型不一致）/ 不存在 / 已软删 → 抛错", () => {
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() => requireHook(makeCtx(), char.id)).toThrow(/伏笔不存在或已软删/);
    expect(() => requireHook(makeCtx(), "hook-999")).toThrow(/伏笔不存在或已软删/);
    const hook = createEntity(db, { type: "hook", name: "身世之谜" });
    softDeleteEntity(db, hook.id, T0);
    expect(() => requireHook(makeCtx(), hook.id)).toThrow(/伏笔不存在或已软删/);
  });
});

describe("checkProposalAborted（signal 中止，决策 16 ③）", () => {
  it("signal 已中止 → 抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => checkProposalAborted(controller.signal)).toThrow(AbortedError);
  });

  it("未中止 / 无 signal → 不抛", () => {
    expect(() => checkProposalAborted(undefined)).not.toThrow();
    expect(() => checkProposalAborted(new AbortController().signal)).not.toThrow();
  });
});
