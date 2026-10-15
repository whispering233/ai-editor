// 根首页分区 / 预置作家卡 / 工作区落点（卡 6 改版）的纯函数单测。
//
// 为什么单测纯函数而不是渲 Dashboard——client 无 jsdom，zustand 的 SSR 快照读不到预置的书架 state
//（同 lib/shelf.test.ts 的理由）；分区、卡片合并/过滤与落点必须可测，故都落在 lib/workspace.ts。
import { describe, expect, it } from "vitest";
import { AUTHOR_CATALOG, AUTHOR_IDS, type ProjectListBook } from "@whispering233/ai-editor-shared";
import {
  partitionWorkspaces,
  practiceAuthorCards,
  practiceCardStatus,
  WORKSPACE_ENTRY_PATH,
  WORKSPACE_SECTION_TITLE,
} from "./workspace";

function book(over: Partial<ProjectListBook> & Pick<ProjectListBook, "id" | "kind">): ProjectListBook {
  return {
    name: over.id,
    path: `/root/${over.kind}/${over.id}`,
    authorId: null,
    updatedAt: "2026-10-01T10:00:00Z",
    ...over,
  };
}

/** 首位预置作家（当前清单只有一位，但断言一律按清单派生，不写死作家名） */
const AUTHOR = AUTHOR_CATALOG[AUTHOR_IDS[0]];

/** 某作家的练习工作区（`authorId` 已识别） */
function practiceBook(
  over: Partial<ProjectListBook> & Pick<ProjectListBook, "id" | "updatedAt">,
): ProjectListBook {
  return book({ kind: "practice", authorId: AUTHOR.id, name: AUTHOR.name, ...over });
}

describe("partitionWorkspaces（根首页按 kind 分区）", () => {
  it("小说与练习各归各的分区，互不串台", () => {
    const novel = book({ id: "n1", kind: "novel" });
    const practice = practiceBook({ id: "p1", updatedAt: "2026-10-01T10:00:00Z" });
    const partitions = partitionWorkspaces([novel, practice]);
    expect(partitions.novel).toEqual([novel]);
    expect(partitions.practice).toEqual([practice]);
  });

  it("保持服务端跨目录统一排序（只分组、不重排）", () => {
    const a = book({ id: "n1", kind: "novel", updatedAt: "2026-10-03T10:00:00Z" });
    const b = practiceBook({ id: "p1", updatedAt: "2026-10-02T10:00:00Z" });
    const c = book({ id: "n2", kind: "novel", updatedAt: "2026-10-01T10:00:00Z" });
    const partitions = partitionWorkspaces([a, b, c]);
    expect(partitions.novel.map((x) => x.id)).toEqual(["n1", "n2"]);
    expect(partitions.practice.map((x) => x.id)).toEqual(["p1"]);
  });

  it("两个分区恒有键（未加载 / 空列表 → 各自空数组，不是 undefined）", () => {
    expect(partitionWorkspaces(null)).toEqual({ novel: [], practice: [] });
    expect(partitionWorkspaces([])).toEqual({ novel: [], practice: [] });
  });
});

describe("practiceAuthorCards（练习分区 = 预置作家清单 ∪ 已有工作区）", () => {
  it("未加载 / 空列表 → 全部预置作家各一张「未开始」卡（顺序 = 预置清单顺序）", () => {
    const cards = practiceAuthorCards(null);
    expect(cards.map((c) => c.author.id)).toEqual(AUTHOR_IDS);
    expect(cards.map((c) => c.workspace)).toEqual(AUTHOR_IDS.map(() => null));
    expect(cards.every((c) => practiceCardStatus(c, null) === "未开始")).toBe(true);
  });

  it("已有数据的在前（列表顺序 = updatedAt 倒序），未开始的按预置清单顺序垫后", () => {
    // 服务端已按 updatedAt 倒序：p-new → p-old
    const newer = practiceBook({ id: "p-new", updatedAt: "2026-10-05T10:00:00Z" });
    const older = practiceBook({ id: "p-old", updatedAt: "2026-10-02T10:00:00Z" });
    const cards = practiceAuthorCards([newer, older, book({ id: "n1", kind: "novel" })]);
    expect(cards).toHaveLength(AUTHOR_IDS.length);
    // p-old 与 p-new 同作家 ⇒ 只出一张卡（取列表里最新的那个）
    expect(cards[0].workspace?.id).toBe("p-new");
    expect(cards.slice(1).map((c) => c.author.id)).toEqual(AUTHOR_IDS.slice(1));
    expect(cards.slice(1).every((c) => c.workspace === null)).toBe(true);
  });

  it("小说工作区不进练习卡列（`kind` 判据）", () => {
    const cards = practiceAuthorCards([book({ id: "n1", kind: "novel" })]);
    expect(cards.every((c) => c.workspace === null)).toBe(true);
  });

  it("未识别 authorId 的存量练习工作区**不列出**（服务端照列、客户端过滤；目录留盘）", () => {
    const legacy = book({ id: "p-legacy", kind: "practice", authorId: null });
    const unknown = book({ id: "p-unknown", kind: "practice", authorId: "gone" });
    const known = practiceBook({ id: "p-known", updatedAt: "2026-10-04T10:00:00Z" });
    const cards = practiceAuthorCards([legacy, unknown, known]);
    expect(cards.map((c) => c.workspace?.id ?? null)).toEqual([
      "p-known",
      ...AUTHOR_IDS.slice(1).map(() => null),
    ]);
    expect(cards.map((c) => c.author.id)).toEqual(AUTHOR_IDS);
  });

  it("卡上的作家取自 shared 清单（卡片与 `AUTHOR_CATALOG` 同一份，不复制名字）", () => {
    const cards = practiceAuthorCards(null);
    for (const card of cards) expect(card.author).toBe(AUTHOR_CATALOG[card.author.id]);
  });
});

describe("practiceCardStatus（状态行文案）", () => {
  it("未开始 → 「未开始」（不出现「最近更新」）", () => {
    const [card] = practiceAuthorCards(null);
    const status = practiceCardStatus(card, null);
    expect(status).toBe("未开始");
    expect(status).not.toContain("最近更新");
  });

  it("有数据且样本数未知 → 只有「最近更新 …」（不猜数字）", () => {
    const [card] = practiceAuthorCards([practiceBook({ id: "p1", updatedAt: "2026-10-02T10:00:00Z" })]);
    const status = practiceCardStatus(card, null);
    expect(status.startsWith("最近更新 ")).toBe(true);
    expect(status).not.toContain("篇范文");
  });

  it("有数据且样本数已知 → 「N 篇范文 · 最近更新 …」", () => {
    const [card] = practiceAuthorCards([practiceBook({ id: "p1", updatedAt: "2026-10-02T10:00:00Z" })]);
    const status = practiceCardStatus(card, 3);
    expect(status.startsWith("3 篇范文 · 最近更新 ")).toBe(true);
  });
});

describe("工作区落点与分区标题（kind → 文案/路径的单一定义处）", () => {
  it("落点：小说 → /overview、练习 → /practice（练习没有项目概览页）", () => {
    expect(WORKSPACE_ENTRY_PATH).toEqual({ novel: "/overview", practice: "/practice" });
  });

  it("分区标题：小说 / 文风练习（与 DESIGN.md §根首页分区表一致）", () => {
    expect(WORKSPACE_SECTION_TITLE).toEqual({ novel: "小说", practice: "文风练习" });
  });
});
