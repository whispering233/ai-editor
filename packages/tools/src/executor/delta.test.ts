// S6.7 执行类工具测试：Delta（add_delta）
// 覆盖：写路径正确性（order 服务端全局单调生成、changes 原样落库）、
//   description 取 **proposal.summary**（S6.6 delta.ts 契约：执行器取 summary 作人类可读描述）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, createEntity, listDeltasByTarget, openDatabase, type Db } from "@ai-editor/db";
import { writeOutlineFile } from "@ai-editor/db";
import { buildProposal } from "../proposal/types.js";
import { executeAddDelta } from "./delta.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-delta-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 一棵 卷[章[场景一]] 的大纲树 */
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
            children: [{ id: "sc-1", type: "scene", title: "场景一", updated_at: T0 }],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

describe("add_delta", () => {
  it("写路径：changes 原样落库，description 取 proposal.summary，返回新 id（delta- 前缀）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    const proposal = buildProposal(
      makeCtx(),
      "propose_add_delta",
      { node_id: "sc-1", target_type: "character", target_id: char.id, changes: [{ field: "hp", op: "update", from: 100, to: 80 }] },
      [],
      "为节点「场景一」追加 1 项属性变更",
    );
    const result = executeAddDelta(makeCtx(), proposal);
    expect(result.id).toMatch(/^delta-/);
    const deltas = listDeltasByTarget(db, char.id, dir);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      nodeId: "sc-1",
      targetType: "character",
      targetId: char.id,
      changes: [{ field: "hp", op: "update", from: 100, to: 80 }],
      description: "为节点「场景一」追加 1 项属性变更", // proposal.summary
    });
  });

  it("order 服务端全局单调生成（两次插入 order 递增）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "sc-1", target_type: "character", target_id: char.id, changes: [{ field: "a", op: "set", to: 1 }] }, [], "第一条"));
    executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "sc-1", target_type: "character", target_id: char.id, changes: [{ field: "b", op: "set", to: 2 }] }, [], "第二条"));
    const orders = listDeltasByTarget(db, char.id, dir).map((d) => d.order);
    expect(orders).toEqual([1, 2]);
  });

  it("缺 changes → 抛错（参数防御）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const char = createEntity(db, { type: "character", name: "阿强" });
    expect(() =>
      executeAddDelta(makeCtx(), buildProposal(makeCtx(), "propose_add_delta", { node_id: "sc-1", target_type: "character", target_id: char.id }, [], "s")),
    ).toThrow(/执行参数缺失或非法: changes/);
  });
});
