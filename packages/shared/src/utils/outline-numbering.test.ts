// 大纲展示编号派生测试（卷号 + 章号单一来源）。
// 覆盖：卷号（含无可见章的卷照样占号）、章号（跨卷连续 + 存量直挂 root 章）、软删跳过、直挂 root 章空卷归属、空树。
// 消费方（大纲页徽标 / 小说文档导出）的字段契约见 `docs/ui/DESIGN.md` §`type-badge`、`docs/api/10-api-project.md`。
import { describe, expect, it } from "vitest";
import type { OutlineTree } from "../types/outline.js";
import { numberVisibleOutline } from "./outline-numbering.js";

const T = "2026-09-01T10:00:00Z";

/**
 * 用例树：vol-1 → ch-1 / ch-2；vol-empty（无章）；vol-soft（软删整卷，含 ch-s1）；
 * vol-2 → ch-3 / ch-d1（软删章）；ch-9（存量直挂 root）。
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
      { id: "vol-empty", type: "volume", title: "空卷", updatedAt: T },
      {
        id: "vol-soft",
        type: "volume",
        title: "软删卷",
        updatedAt: T,
        deleted: true,
        children: [{ id: "ch-s1", type: "chapter", title: "软删卷内章", updatedAt: T }],
      },
      {
        id: "vol-2",
        type: "volume",
        title: "第二卷",
        updatedAt: T,
        children: [
          {
            id: "ch-3",
            type: "chapter",
            title: "第三章",
            updatedAt: T,
            children: [{ id: "sc-2", type: "scene", title: "场景二", updatedAt: T }],
          },
          { id: "ch-d1", type: "chapter", title: "软删章", updatedAt: T, deleted: true },
        ],
      },
      { id: "ch-9", type: "chapter", title: "旧根级章", updatedAt: T },
    ],
  };
}

describe("numberVisibleOutline（展示口径编号：卷序 + 全局章序）", () => {
  it("卷号 = 顶层可见卷树序 1-based；无可见章的卷照样占号；软删卷不占号", () => {
    expect(numberVisibleOutline(tree()).volumes).toEqual([
      { volumeId: "vol-1", volumeTitle: "第一卷", volumeLabel: "第1卷" },
      { volumeId: "vol-empty", volumeTitle: "空卷", volumeLabel: "第2卷" },
      { volumeId: "vol-2", volumeTitle: "第二卷", volumeLabel: "第3卷" },
    ]);
  });

  it("章号 = 可见章先序（跨卷连续，含存量直挂 root 的章）；场景不编号", () => {
    const { chapters } = numberVisibleOutline(tree());
    expect(chapters.map((c) => [c.chapterId, c.chapterLabel, c.chapterTitle])).toEqual([
      ["ch-1", "第1章", "第一章"],
      ["ch-2", "第2章", "第二章"],
      ["ch-3", "第3章", "第三章"],
      ["ch-9", "第4章", "旧根级章"],
    ]);
  });

  it("章带上所属卷的 id / 卷号 / 卷名", () => {
    const { chapters } = numberVisibleOutline(tree());
    expect(chapters[0]).toMatchObject({
      volumeId: "vol-1",
      volumeLabel: "第1卷",
      volumeTitle: "第一卷",
    });
    expect(chapters[2]).toMatchObject({
      volumeId: "vol-2",
      volumeLabel: "第3卷",
      volumeTitle: "第二卷",
    });
  });

  it("直挂 root 的章：volumeId / volumeLabel / volumeTitle 皆空串", () => {
    const rootChapter = numberVisibleOutline(tree()).chapters.find((c) => c.chapterId === "ch-9");
    expect(rootChapter).toEqual({
      chapterId: "ch-9",
      chapterLabel: "第4章",
      chapterTitle: "旧根级章",
      volumeId: "",
      volumeLabel: "",
      volumeTitle: "",
    });
  });

  it("软删节点及其整棵子树跳过：软删章不占号、软删卷整卷不入卷序与章序", () => {
    const { volumes, chapters } = numberVisibleOutline(tree());
    const ids = [...volumes.map((v) => v.volumeId), ...chapters.map((c) => c.chapterId)];
    expect(ids).not.toContain("vol-soft");
    expect(ids).not.toContain("ch-s1");
    expect(ids).not.toContain("ch-d1"); // 软删章不占号：其后 ch-9 仍是第4章（下标不重排）
  });

  it("null / 空树 → 两数组皆空", () => {
    const empty: OutlineTree = { id: "root", type: "root", schemaVersion: 1, children: [] };
    expect(numberVisibleOutline(null)).toEqual({ volumes: [], chapters: [] });
    expect(numberVisibleOutline(empty)).toEqual({ volumes: [], chapters: [] });
  });
});
