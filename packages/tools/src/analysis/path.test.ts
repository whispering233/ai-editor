// S6.4 分析工具测试：trace_plot_paths
// 覆盖：树路径（顺向推进/回溯）/ plot_edge 连线路径（终点过滤）/ 不同分支无树路径 /
//   risk_factors（缺 goal/reversal、路径过长、软删节点）/ 节点不存在或软删 → null / signal aborted
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OutlineFileTree } from "@whispering233/ai-editor-shared";
import type { ToolContext } from "../context.js";
import { closeDatabase, openDatabase, type Db } from "@whispering233/ai-editor-db";
import { createRelation } from "@whispering233/ai-editor-db";
import { findOutlineNode, readOutlineFile, writeOutlineFile } from "@whispering233/ai-editor-db";
import { runTracePlotPaths } from "./path.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ai-editor-tools-path-"));
  db = openDatabase(join(dir, "data.db"));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-08-01T10:00:00Z";

/** 两卷结构：vol-1[ch-1[sc-1,sc-2]] + vol-2[ch-2[sc-3]]（跨卷 = 不同分支，无树路径） */
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
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updated_at: T0,
        children: [
          {
            id: "ch-2",
            type: "chapter",
            title: "第二章",
            updated_at: T0,
            children: [{ id: "sc-3", type: "scene", title: "场景三", updated_at: T0 }],
          },
        ],
      },
    ],
  };
}

function makeCtx(): ToolContext {
  return { db, outlineDir: dir, projectId: "proj-test" };
}

/** 大纲节点间 plot_edge 连线（决策 10 画布连线） */
function addEdge(source: string, target: string): void {
  createRelation(
    db,
    { sourceType: "outline_node", sourceId: source, targetType: "outline_node", targetId: target, relationType: "plot_edge" },
    dir,
  );
}

/** 直接改 outline.json 软删指定节点 */
function softDeleteNode(nodeId: string): void {
  const tree = readOutlineFile(dir);
  const node = findOutlineNode(tree, nodeId)!;
  node.deleted = true;
  node.deleted_at = T0;
  writeOutlineFile(dir, tree);
}

describe("trace_plot_paths 树路径", () => {
  it("祖先 → 后代：顺向链（含中间节点）；后代 → 祖先：回溯链", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const forward = runTracePlotPaths(makeCtx(), { from_node_id: "ch-1", to_node_id: "sc-2" })!;
    expect(forward.paths).toHaveLength(1);
    expect(forward.paths[0].nodes.map((n) => n.id)).toEqual(["ch-1", "sc-2"]);
    expect(forward.paths[0].description).toContain("直接推进");

    const backward = runTracePlotPaths(makeCtx(), { from_node_id: "sc-2", to_node_id: "vol-1" })!;
    expect(backward.paths).toHaveLength(1);
    expect(backward.paths[0].nodes.map((n) => n.id)).toEqual(["sc-2", "ch-1", "vol-1"]);
    expect(backward.paths[0].description).toContain("回溯");
    expect(backward.paths[0].nodes[0].name).toBe("场景二"); // name = title
  });

  it("不同分支（跨卷）无树路径：仅连线路径；无连线 → paths 空", () => {
    writeOutlineFile(dir, seedOutlineTree());
    const noEdge = runTracePlotPaths(makeCtx(), { from_node_id: "sc-1", to_node_id: "sc-3" })!;
    expect(noEdge.paths).toEqual([]);

    addEdge("sc-1", "sc-3"); // 跨卷连线
    const withEdge = runTracePlotPaths(makeCtx(), { from_node_id: "sc-1", to_node_id: "sc-3" })!;
    expect(withEdge.paths).toHaveLength(1);
    expect(withEdge.paths[0].nodes.map((n) => n.id)).toEqual(["sc-1", "sc-3"]);
    expect(withEdge.paths[0].description).toContain("plot_edge");
  });

  it("连线路径终点过滤：from 出发到其他节点的路径不返回", () => {
    writeOutlineFile(dir, seedOutlineTree());
    addEdge("sc-1", "sc-2");
    addEdge("sc-1", "sc-3"); // 另一条终点
    const result = runTracePlotPaths(makeCtx(), { from_node_id: "sc-1", to_node_id: "sc-2" })!;
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].nodes.map((n) => n.id)).toEqual(["sc-1", "sc-2"]);
  });
});

describe("trace_plot_paths risk_factors", () => {
  it("scene 缺 goal → 风险；chapter 缺 reversal → 风险", () => {
    const tree = seedOutlineTree();
    // ch-1 带 reversal、sc-1 带 goal；ch-2/sc-3 均缺
    const ch1 = tree.children[0].children?.[0];
    if (ch1?.type !== "chapter") throw new Error("fixture 缺失 ch-1");
    ch1.data = { reversal: "反转" };
    const sc1 = ch1.children?.[0];
    if (sc1 === undefined) throw new Error("fixture 缺失 sc-1");
    sc1.data = { goal: "目标" };
    writeOutlineFile(dir, tree);

    const result = runTracePlotPaths(makeCtx(), { from_node_id: "vol-2", to_node_id: "sc-3" })!;
    const risks = result.paths[0].risk_factors;
    expect(risks).toEqual(expect.arrayContaining([expect.stringContaining("「场景三」未定义目标")]));
    expect(risks).toEqual(expect.arrayContaining([expect.stringContaining("「第二章」未定义反转")]));
  });

  it("连线路径 4 节点（3 跳推演上限）→ 路径过长风险；树路径途经软删节点 → 数据不一致风险", () => {
    writeOutlineFile(dir, seedOutlineTree());
    // 先追加 sc-4/sc-5 于 ch-2（sc-3 兄弟），再建连线（createRelation 校验端点存在）
    const tree = readOutlineFile(dir);
    const ch2 = findOutlineNode(tree, "ch-2");
    if (ch2?.type !== "chapter") throw new Error("fixture 缺失 ch-2");
    ch2.children = [
      ...(ch2.children ?? []),
      { id: "sc-4", type: "scene", title: "场景四", updated_at: T0 },
      { id: "sc-5", type: "scene", title: "场景五", updated_at: T0 },
    ];
    writeOutlineFile(dir, tree);
    addEdge("sc-1", "sc-3");
    addEdge("sc-3", "sc-4");
    addEdge("sc-4", "sc-5");

    // 连线链 sc-1→sc-3→sc-4→sc-5 = 4 节点 3 跳（depth=3 全量深度）→ 过长风险
    const result = runTracePlotPaths(makeCtx(), { from_node_id: "sc-1", to_node_id: "sc-5" })!;
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].nodes).toHaveLength(4);
    expect(result.paths[0].risk_factors).toEqual(expect.arrayContaining([expect.stringContaining("路径过长")]));

    // 树路径途经软删节点（软删中间 ch-1，from/to 未软删）→ 数据不一致风险
    softDeleteNode("ch-1");
    const withSoft = runTracePlotPaths(makeCtx(), { from_node_id: "vol-1", to_node_id: "sc-1" })!;
    expect(withSoft.paths[0].nodes.map((n) => n.id)).toEqual(["vol-1", "ch-1", "sc-1"]);
    expect(withSoft.paths[0].risk_factors).toEqual(expect.arrayContaining([expect.stringContaining("已软删节点")]));
  });
});

describe("trace_plot_paths 边界", () => {
  it("from/to 不存在或已软删 → null；signal 已中止 → 抛错", () => {
    writeOutlineFile(dir, seedOutlineTree());
    expect(runTracePlotPaths(makeCtx(), { from_node_id: "sc-999", to_node_id: "sc-1" })).toBeNull();
    softDeleteNode("sc-2");
    expect(runTracePlotPaths(makeCtx(), { from_node_id: "sc-1", to_node_id: "sc-2" })).toBeNull();

    const controller = new AbortController();
    controller.abort();
    expect(() => runTracePlotPaths(makeCtx(), { from_node_id: "sc-1", to_node_id: "sc-3" }, controller.signal)).toThrow(/中止/);
  });
});
