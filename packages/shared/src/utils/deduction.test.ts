// 推演节点标记纯函数测试（D1）
// 覆盖：可见章先序（软删子树跳过 / 存量根级章 / 空树）、单/多标记文案与序号、软删后编号重排、
// 失效 id 过滤（不存在 / 软删 / 非章）、重复 id 去重、空数组。
import { describe, expect, it } from "vitest";
import type { OutlineTree } from "../types/outline.js";
import { buildDeductionMarks, orderVisibleChapters } from "./deduction.js";

const T = "2026-08-01T10:00:00Z";

/**
 * 用例树：vol-1 → ch-1（可见章 1）/ ch-2（可见章 2）；vol-2 → ch-3（可见章 3）；
 * 软删卷 vol-soft（含 ch-s1）/ 软删章 ch-d1（直挂 root）——整棵软删子树与软删章都不计。
 */
function tree(): OutlineTree {
  return {
    id: "root",
    type: "root",
    schemaVersion: 1,
    children: [
      {
        id: "vol-1",
        type: "volume",
        title: "第一卷",
        updatedAt: T,
        children: [
          {
            id: "ch-1",
            type: "chapter",
            title: "第一章",
            updatedAt: T,
            children: [{ id: "sc-1", type: "scene", title: "场景一", updatedAt: T }],
          },
          { id: "ch-2", type: "chapter", title: "第二章", updatedAt: T },
        ],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updatedAt: T,
        children: [{ id: "ch-3", type: "chapter", title: "第三章", updatedAt: T }],
      },
      { id: "ch-d1", type: "chapter", title: "已删章", updatedAt: T, deleted: true, deletedAt: T },
      {
        id: "vol-soft",
        type: "volume",
        title: "软删卷",
        updatedAt: T,
        deleted: true,
        deletedAt: T,
        children: [{ id: "ch-s1", type: "chapter", title: "软删卷内章", updatedAt: T }],
      },
    ],
  };
}

describe("orderVisibleChapters（唯一编号口径：可见章先序）", () => {
  it("先序输出可见章 id：软删章与软删子树整棵跳过，卷/场景不入列", () => {
    expect(orderVisibleChapters(tree())).toEqual(["ch-1", "ch-2", "ch-3"]);
  });

  it("存量直挂 root 的章按兄弟位置参与（不占卷号）", () => {
    const withRootChapter: OutlineTree = {
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [
        { id: "ch-9", type: "chapter", title: "旧根级章", updatedAt: T },
        {
          id: "vol-1",
          type: "volume",
          title: "第一卷",
          updatedAt: T,
          children: [{ id: "ch-1", type: "chapter", title: "第一章", updatedAt: T }],
        },
      ],
    };
    expect(orderVisibleChapters(withRootChapter)).toEqual(["ch-9", "ch-1"]);
  });

  it("null / 空树 → []", () => {
    expect(orderVisibleChapters(null)).toEqual([]);
    expect(orderVisibleChapters({ id: "root", type: "root", schemaVersion: 1, children: [] })).toEqual([]);
  });
});

describe("buildDeductionMarks（标记集合 → 有序派生标记）", () => {
  it("空数组 → []（未标记不产生任何形态）", () => {
    expect(buildDeductionMarks(tree(), [])).toEqual([]);
  });

  it("单标记 → role single、文案 `推演节点`、章号 = 可见章序位置", () => {
    expect(buildDeductionMarks(tree(), ["ch-2"])).toEqual([
      {
        nodeId: "ch-2",
        index: 1,
        role: "single",
        label: "推演节点",
        chapterNumber: 2,
        title: "第二章",
      },
    ]);
  });

  it("多标记 → 首位 `推演起点` / 末位 `推演终点` / 中间 `推演节点 k`（k = 集合内序号）", () => {
    const marks = buildDeductionMarks(tree(), ["ch-1", "ch-2", "ch-3"]);
    expect(marks.map((m) => [m.nodeId, m.index, m.role, m.label, m.chapterNumber])).toEqual([
      ["ch-1", 1, "start", "推演起点", 1],
      ["ch-2", 2, "node", "推演节点 2", 2],
      ["ch-3", 3, "end", "推演终点", 3],
    ]);
  });

  it("顺序 = 可见章先序（不取标记先后）：乱序输入 + 重复 id → 树序去重，章号取真实位置", () => {
    const marks = buildDeductionMarks(tree(), ["ch-3", "ch-1", "ch-3", "ch-1"]);
    expect(marks.map((m) => [m.nodeId, m.index, m.role, m.label, m.chapterNumber])).toEqual([
      ["ch-1", 1, "start", "推演起点", 1],
      ["ch-3", 2, "end", "推演终点", 3],
    ]);
  });

  it("失效 id 过滤：不存在 / 已软删 / 软删卷内章 / 非章（卷·场景）一律丢弃", () => {
    const marks = buildDeductionMarks(tree(), [
      "ch-1",
      "ch-999",
      "ch-d1",
      "ch-s1",
      "vol-1",
      "vol-2",
      "sc-1",
    ]);
    expect(marks.map((m) => m.nodeId)).toEqual(["ch-1"]);
    expect(marks[0].label).toBe("推演节点"); // 过滤后只剩一个 → 回到单标记口径
  });

  it("全部失效 → []（不抛错）", () => {
    expect(buildDeductionMarks(tree(), ["ch-999", "vol-1", "sc-1"])).toEqual([]);
  });

  it("软删后编号重排：软删 ch-1 后 ch-2 变章 1，且只剩两标记时文案回到起点/终点", () => {
    const withDeletedFirst: OutlineTree = {
      id: "root",
      type: "root",
      schemaVersion: 1,
      children: [
        {
          id: "vol-1",
          type: "volume",
          title: "第一卷",
          updatedAt: T,
          children: [
            { id: "ch-1", type: "chapter", title: "第一章", updatedAt: T, deleted: true, deletedAt: T },
            { id: "ch-2", type: "chapter", title: "第二章", updatedAt: T },
            { id: "ch-3", type: "chapter", title: "第三章", updatedAt: T },
          ],
        },
      ],
    };
    const marks = buildDeductionMarks(withDeletedFirst, ["ch-1", "ch-2", "ch-3"]);
    expect(marks.map((m) => [m.nodeId, m.label, m.chapterNumber])).toEqual([
      ["ch-2", "推演起点", 1], // 软删 ch-1 被过滤，ch-2 重排为第 1 章并升为起点
      ["ch-3", "推演终点", 2],
    ]);
  });
});
