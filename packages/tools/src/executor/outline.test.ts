// S6.7 执行类工具测试：大纲（create_outline_node / move_node / delete_node）
// 覆盖：写路径正确性（缺省挂根 / 显式父 / scene 挂 chapter、移动重排 + 父版本戳、
//   软删 + 递归子树可还原——决策 12）、失败语义（层级非法/节点不存在抛错）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileNode, OutlineFileTree } from "@ai-editor/shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, findOutlineNode, openDatabase, readOutlineFile, writeOutlineFile, type Db } from "@ai-editor/db";
import { buildProposal } from "../proposal/types.js";
import { executeCreateOutlineNode, executeDeleteNode, executeMoveNode } from "./outline.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-exec-outline-"));
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

function makeProposal(type: string, args: Record<string, unknown>): ReturnType<typeof buildProposal> {
  return buildProposal(makeCtx(), type, args, [], `测试摘要 ${type}`);
}

/** 读树取节点 */
function nodeOf(nodeId: string) {
  return findOutlineNode(readOutlineFile(dir), nodeId);
}

/** 取节点 children（scene 为叶子无 children——测试树均为卷/章，断言前显式取） */
function childrenOf(node: OutlineFileNode | undefined): OutlineFileNode[] {
  expect(node).toBeDefined();
  const kids = (node as { children?: OutlineFileNode[] }).children;
  expect(kids).toBeDefined();
  return kids!;
}

describe("create_outline_node", () => {
  it("写路径：parent_id 缺省挂根（决策 19 volume 挂根），返回新 id（vol- 前缀）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeCreateOutlineNode(makeCtx(), makeProposal("propose_outline_node", { type: "volume", title: "第二卷" }));
    expect(result.id).toMatch(/^vol-/);
    expect(nodeOf(result.id as string)).toMatchObject({ type: "volume", title: "第二卷" });
    const tree = readOutlineFile(dir);
    expect(tree.children.map((c) => c.id)).toContain(result.id);
  });

  it("scene 挂 chapter（显式 parent_id）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeCreateOutlineNode(makeCtx(), makeProposal("propose_outline_node", { type: "scene", title: "场景三", parent_id: "ch-1" }));
    expect(result.id).toMatch(/^sc-/);
    expect(childrenOf(nodeOf("ch-1")).map((c) => c.id)).toContain(result.id);
    // 父节点版本戳刷新（决策 19）
    expect(nodeOf("ch-1")!.updated_at >= T0).toBe(true);
  });

  it("层级非法 → 抛错（scene 不能挂根/挂卷，决策 19 严格三层）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => executeCreateOutlineNode(makeCtx(), makeProposal("propose_outline_node", { type: "scene", title: "游离场景" }))).toThrow(/层级非法/);
    expect(() => executeCreateOutlineNode(makeCtx(), makeProposal("propose_outline_node", { type: "chapter", title: "章", parent_id: "ch-1" }))).toThrow(/层级非法/);
  });

  it("父节点不存在 → 抛错（PARENT_NOT_FOUND）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => executeCreateOutlineNode(makeCtx(), makeProposal("propose_outline_node", { type: "chapter", title: "章", parent_id: "vol-999" }))).toThrow(/父节点不存在/);
  });
});

describe("move_node", () => {
  it("写路径：跨父移动 + order 重排，返回 previousParentId/newParentId", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeMoveNode(makeCtx(), makeProposal("propose_move_node", { node_id: "sc-2", parent_id: "ch-1", order: 0 }));
    expect(result).toMatchObject({ id: "sc-2", previousParentId: "ch-1", newParentId: "ch-1" });
    expect(childrenOf(nodeOf("ch-1")).map((c) => c.id)).toEqual(["sc-2", "sc-1"]); // 移动到 0 位
  });

  it("移到 root（决策 19：chapter 可挂根）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeMoveNode(makeCtx(), makeProposal("propose_move_node", { node_id: "ch-1", parent_id: "root", order: 0 }));
    expect(result.newParentId).toBe("root");
    expect(readOutlineFile(dir).children.map((c) => c.id)).toEqual(["ch-1", "vol-1"]);
  });

  it("order 越界 clamp（拖拽边界宽松处理，db 语义）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    executeMoveNode(makeCtx(), makeProposal("propose_move_node", { node_id: "sc-1", parent_id: "ch-1", order: 99 }));
    expect(childrenOf(nodeOf("ch-1")).map((c) => c.id)).toEqual(["sc-2", "sc-1"]); // clamp 到末尾
  });

  it("节点不存在 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => executeMoveNode(makeCtx(), makeProposal("propose_move_node", { node_id: "sc-999", parent_id: "ch-1", order: 0 }))).toThrow(/大纲节点不存在/);
  });
});

describe("delete_node", () => {
  it("写路径：软删 + 递归子树（决策 12），本体保留（deleted 标记）可回收站还原", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = executeDeleteNode(makeCtx(), makeProposal("propose_delete_node", { node_id: "ch-1" }));
    expect(result).toMatchObject({ id: "ch-1", deleted: true, cascadedChildren: 2 }); // sc-1/sc-2 级联
    const tree = readOutlineFile(dir);
    const ch = findOutlineNode(tree, "ch-1")!;
    expect(ch.deleted).toBe(true);
    expect((ch as { children: { deleted?: boolean }[] }).children.every((c) => c.deleted === true)).toBe(true); // 子树级联
  });

  it("节点不存在 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => executeDeleteNode(makeCtx(), makeProposal("propose_delete_node", { node_id: "sc-999" }))).toThrow(/大纲节点不存在/);
  });
});
