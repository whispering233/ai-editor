// 根首页分区分组 + 工作区落点（卡 8）的纯函数单测。
//
// 为什么单测纯函数而不是渲 Dashboard——client 无 jsdom，zustand 的 SSR 快照读不到预置的书架 state
//（同 lib/shelf.test.ts 的理由）；分区与落点必须可测，故都落在 lib/workspace.ts。
import { describe, expect, it } from "vitest";
import type { ProjectListBook } from "@whispering233/ai-editor-shared";
import {
  PRACTICE_EMPTY_HINT,
  partitionWorkspaces,
  WORKSPACE_ENTRY_PATH,
  WORKSPACE_SECTION_TITLE,
} from "./workspace";

function book(over: Partial<ProjectListBook> & Pick<ProjectListBook, "id" | "kind">): ProjectListBook {
  return {
    name: over.id,
    path: `/root/${over.kind}/${over.id}`,
    updatedAt: "2026-10-01T10:00:00Z",
    ...over,
  };
}

describe("partitionWorkspaces（根首页按 kind 分区）", () => {
  it("小说与练习各归各的分区，互不串台", () => {
    const novel = book({ id: "n1", kind: "novel" });
    const practice = book({ id: "p1", kind: "practice" });
    const partitions = partitionWorkspaces([novel, practice]);
    expect(partitions.novel).toEqual([novel]);
    expect(partitions.practice).toEqual([practice]);
  });

  it("保持服务端跨目录统一排序（只分组、不重排）", () => {
    const a = book({ id: "n1", kind: "novel", updatedAt: "2026-10-03T10:00:00Z" });
    const b = book({ id: "p1", kind: "practice", updatedAt: "2026-10-02T10:00:00Z" });
    const c = book({ id: "n2", kind: "novel", updatedAt: "2026-10-01T10:00:00Z" });
    const partitions = partitionWorkspaces([a, b, c]);
    expect(partitions.novel.map((x) => x.id)).toEqual(["n1", "n2"]);
    expect(partitions.practice.map((x) => x.id)).toEqual(["p1"]);
  });

  it("两个分区恒有键（未加载 / 空列表 → 各自空数组，不是 undefined）", () => {
    expect(partitionWorkspaces(null)).toEqual({ novel: [], practice: [] });
    expect(partitionWorkspaces([])).toEqual({ novel: [], practice: [] });
  });

  it("某分区无内容 → 该分区空数组（渲染侧据此给引导文案，不是空白块）", () => {
    const partitions = partitionWorkspaces([book({ id: "p1", kind: "practice" })]);
    expect(partitions.novel).toEqual([]);
    expect(partitions.practice).toHaveLength(1);
  });
});

describe("工作区落点与分区标题（kind → 文案/路径的单一定义处）", () => {
  it("落点：小说 → /overview、练习 → /practice（练习没有项目概览页）", () => {
    expect(WORKSPACE_ENTRY_PATH).toEqual({ novel: "/overview", practice: "/practice" });
  });

  it("分区标题：小说 / 文风练习（与 DESIGN.md §根首页分区表一致）", () => {
    expect(WORKSPACE_SECTION_TITLE).toEqual({ novel: "小说", practice: "文风练习" });
  });

  it("练习分区空态引导文案非空（空分区渲染一行 caption-text 而不是空卡片）", () => {
    expect(PRACTICE_EMPTY_HINT.trim()).not.toBe("");
  });
});
