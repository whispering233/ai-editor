// S6.6 提案类工具测试：大纲（propose_outline_node / propose_move_node / propose_delete_node）
// 覆盖：tool_result 仅 { proposal_id, summary } 无预览 / 完整提案结构（references 节点级
//   updated_at 快照，决策 19）/ **不落盘**（outline.json 零变化——S6.7 对比核心差异）/
//   严格三层层级校验（决策 19：scene 无 parent 拒绝、scene 挂卷拒绝、章挂章拒绝）/
//   父节点不存在/软删抛错 / signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { AbortedError } from "../analysis/utils.js";
import {
  buildProposeDeleteNode,
  buildProposeMoveNode,
  buildProposeOutlineNode,
  runProposeDeleteNode,
  runProposeMoveNode,
  runProposeOutlineNode,
} from "./outline.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-prop-outline-"));
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

/** 软删指定大纲节点（测试直写 outline.json） */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId);
  expect(node).toBeDefined();
  node!.deleted = true;
  node!.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("propose_outline_node", () => {
  it("tool_result 仅 { proposal_id, summary }，无预览细节（2026-08 修订）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const result = runProposeOutlineNode(makeCtx(), { type: "chapter", title: "第二章", parent_id: "vol-1" });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.proposal_id.startsWith("prop_")).toBe(true);
    expect(result.summary).toBe("新增大纲节点「第二章」（chapter，挂 vol-1）");
  });

  it("完整提案结构：parent_id 缺省挂根（无引用）；指定父 → 父节点级 updated_at 快照（决策 19）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const noParent = buildProposeOutlineNode(makeCtx(), { type: "volume", title: "第二卷" });
    expect(noParent.args).toEqual({ type: "volume", title: "第二卷" }); // 不含 parent_id
    expect(noParent.references).toEqual([]); // root 非节点引用（恒存在）
    const withParent = buildProposeOutlineNode(makeCtx(), { type: "chapter", title: "第二章", parent_id: "vol-1" });
    expect(withParent.args).toEqual({ type: "chapter", title: "第二章", parent_id: "vol-1" });
    expect(withParent.references).toEqual([{ kind: "outline_node", id: "vol-1", updated_at: T0 }]);
    expect(withParent.project_id).toBe("proj-test");
  });

  it("不落盘：调用后 outline.json 零变化（无新节点写入）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    runProposeOutlineNode(makeCtx(), { type: "chapter", title: "第二章", parent_id: "vol-1" });
    const tree = readOutlineFile(dir);
    const vol1 = findOutlineNode(tree, "vol-1") as { children?: { id: string }[] };
    expect(vol1.children).toHaveLength(1); // 仍只有 ch-1
    expect(findOutlineNode(tree, "ch-2")).toBeUndefined();
  });

  it("严格三层（决策 19）：scene 无 parent 拒绝；scene 挂卷拒绝；章挂章拒绝", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => runProposeOutlineNode(makeCtx(), { type: "scene", title: "孤儿场景" })).toThrow(/层级非法/);
    expect(() => runProposeOutlineNode(makeCtx(), { type: "scene", title: "场景", parent_id: "vol-1" })).toThrow(/层级非法/);
    expect(() => runProposeOutlineNode(makeCtx(), { type: "chapter", title: "章", parent_id: "ch-1" })).toThrow(/层级非法/);
    // 合法组合不抛
    expect(() => runProposeOutlineNode(makeCtx(), { type: "scene", title: "场景三", parent_id: "ch-1" })).not.toThrow();
    expect(() => runProposeOutlineNode(makeCtx(), { type: "chapter", title: "直挂根章" })).not.toThrow();
  });

  it("父节点不存在 / 已软删 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => runProposeOutlineNode(makeCtx(), { type: "chapter", title: "章", parent_id: "vol-999" })).toThrow(/大纲节点不存在或已软删/);
    softDeleteNode("vol-1");
    expect(() => runProposeOutlineNode(makeCtx(), { type: "chapter", title: "章", parent_id: "vol-1" })).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("propose_move_node", () => {
  it("完整提案结构：节点 + 目标父两端点引用快照（决策 19）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const proposal = buildProposeMoveNode(makeCtx(), { node_id: "sc-1", parent_id: "ch-1", order: 2 });
    expect(proposal.args).toEqual({ node_id: "sc-1", parent_id: "ch-1", order: 2 });
    expect(proposal.references).toEqual([
      { kind: "outline_node", id: "sc-1", updated_at: T0 },
      { kind: "outline_node", id: "ch-1", updated_at: T0 },
    ]);
    const result = runProposeMoveNode(makeCtx(), { node_id: "sc-1", parent_id: "ch-1", order: 2 });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain("第 2 位");
  });

  it("不落盘：调用后大纲树节点位置零变化", () => {
    writeOutlineFile(dir, seedOutlineTree());
    runProposeMoveNode(makeCtx(), { node_id: "sc-2", parent_id: "ch-1", order: 0 });
    const ch1 = findOutlineNode(readOutlineFile(dir), "ch-1") as { children?: { id: string }[] };
    expect(ch1.children!.map((c) => c.id)).toEqual(["sc-1", "sc-2"]); // 未交换
  });

  it("目标父为 root（决策 19：volume/chapter 可挂根）：提案成功，快照不含 root 引用", () => {
    writeOutlineFile(dir, seedOutlineTree());
    // volume 移到树根（树首）→ 合法，references 只有节点自身（root 非引用对象）
    const proposal = buildProposeMoveNode(makeCtx(), { node_id: "vol-1", parent_id: "root", order: 0 });
    expect(proposal.args).toEqual({ node_id: "vol-1", parent_id: "root", order: 0 });
    expect(proposal.references).toEqual([{ kind: "outline_node", id: "vol-1", updated_at: T0 }]);
    const result = runProposeMoveNode(makeCtx(), { node_id: "vol-1", parent_id: "root", order: 0 });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain("树根");
    // scene 不能挂 root（严格三层，决策 19）→ 拒绝
    expect(() => runProposeMoveNode(makeCtx(), { node_id: "sc-1", parent_id: "root", order: 0 })).toThrow(/层级非法/);
  });

  it("目标父层级非法（决策 19）→ 抛错；节点/父不存在 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => runProposeMoveNode(makeCtx(), { node_id: "sc-1", parent_id: "vol-1", order: 0 })).toThrow(/层级非法/);
    expect(() => runProposeMoveNode(makeCtx(), { node_id: "sc-999", parent_id: "ch-1", order: 0 })).toThrow(/大纲节点不存在或已软删/);
    expect(() => runProposeMoveNode(makeCtx(), { node_id: "sc-1", parent_id: "ch-999", order: 0 })).toThrow(/大纲节点不存在或已软删/);
    softDeleteNode("sc-1");
    expect(() => runProposeMoveNode(makeCtx(), { node_id: "sc-1", parent_id: "ch-1", order: 0 })).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("propose_delete_node", () => {
  it("完整提案结构：引用为节点级 updated_at（决策 19）；tool_result 无预览", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const proposal = buildProposeDeleteNode(makeCtx(), { node_id: "ch-1" });
    expect(proposal.references).toEqual([{ kind: "outline_node", id: "ch-1", updated_at: T0 }]);
    expect(proposal.args).toEqual({ node_id: "ch-1" });
    const result = runProposeDeleteNode(makeCtx(), { node_id: "ch-1" });
    expect(Object.keys(result).sort()).toEqual(["proposal_id", "summary"]);
    expect(result.summary).toContain("删除大纲节点「第一章」");
  });

  it("不落盘：调用后节点仍存在且未标软删（决策 12：软删是执行时才发生）", () => {
    writeOutlineFile(dir, seedOutlineTree());
    runProposeDeleteNode(makeCtx(), { node_id: "ch-1" });
    const node = findOutlineNode(readOutlineFile(dir), "ch-1")!;
    expect(node.deleted).toBeUndefined();
  });

  it("节点不存在 / 已软删 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(() => runProposeDeleteNode(makeCtx(), { node_id: "vol-999" })).toThrow(/大纲节点不存在或已软删/);
    softDeleteNode("vol-1");
    expect(() => runProposeDeleteNode(makeCtx(), { node_id: "vol-1" })).toThrow(/大纲节点不存在或已软删/);
  });
});

describe("signal aborted（决策 16 ③）", () => {
  it("三个大纲提案工具在 signal 已中止时抛 AbortedError", () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = makeCtx();
    expect(() => runProposeOutlineNode(ctx, { type: "volume", title: "卷" }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeMoveNode(ctx, { node_id: "sc-1", parent_id: "ch-1", order: 0 }, controller.signal)).toThrow(AbortedError);
    expect(() => runProposeDeleteNode(ctx, { node_id: "sc-1" }, controller.signal)).toThrow(AbortedError);
  });
});
