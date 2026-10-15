// 练习卡**排序**的可证伪用例（卡 8 P2：`workspace.test.ts` 的「未开始垫后」在单作家清单下恒真）。
//
// 为什么单独一个文件 + mock：`practiceAuthorCards` 的顺序规则是「已有数据的在前、未开始的按预置清单
// 顺序垫后」，而当前清单只有一位作家 ⇒ `cards.slice(1)` 恒为空、断言永远成立。这里用**三位假作家**
// 替换 shared 清单（目录内容无关口径，只驱动顺序），让「垫后」这一段真的可被证伪；真实清单下的
// 其余口径（过滤未识别 authorId、同一作家只出一张卡）仍在 `workspace.test.ts`。
import { describe, expect, it, vi } from "vitest";

// `vi.mock` 的工厂会被提升到文件顶部 ⇒ 清单用 `vi.hoisted` 一起提升（同 vitest 官方口径）
const CATALOG = vi.hoisted(() => ({
  a: { id: "a", name: "假作家甲", intro: "介绍甲", works: [] },
  b: { id: "b", name: "假作家乙", intro: "介绍乙", works: [] },
  c: { id: "c", name: "假作家丙", intro: "介绍丙", works: [] },
}));

vi.mock("@whispering233/ai-editor-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@whispering233/ai-editor-shared")>();
  return {
    ...actual,
    AUTHOR_CATALOG: CATALOG,
    AUTHOR_IDS: ["a", "b", "c"],
    // 真实 `resolveAuthor` 闭包着真实清单 ⇒ 这里一并替换成同语义的解析（判据不变：不认名字）
    resolveAuthor: (value: unknown) =>
      typeof value === "string" && Object.hasOwn(CATALOG, value)
        ? (CATALOG as Record<string, (typeof CATALOG)["a"]>)[value]
        : null,
  };
});

import type { ProjectListBook } from "@whispering233/ai-editor-shared";
import { practiceAuthorCards } from "./workspace";

function practiceBook(id: string, authorId: string, updatedAt: string): ProjectListBook {
  return {
    id,
    name: `练习-${id}`,
    path: `/root/practice/${id}`,
    kind: "practice",
    authorId,
    updatedAt,
  };
}

describe("practiceAuthorCards 的卡序（三作家清单下可证伪）", () => {
  it("已有数据的在前（保持服务端的 updatedAt 倒序），未开始的按清单顺序垫后", () => {
    const cards = practiceAuthorCards([
      practiceBook("p1", "b", "2026-10-05T10:00:00Z"),
      practiceBook("p2", "c", "2026-10-02T10:00:00Z"),
    ]);
    // 有工作区的两位按传入顺序在前，没工作区的甲垫后（三者顺序与清单一致时才通过）
    expect(cards.map((card) => card.author.id)).toEqual(["b", "c", "a"]);
    expect(cards.map((card) => card.workspace?.id ?? null)).toEqual(["p1", "p2", null]);
  });

  it("全部未开始 → 顺序 = 清单顺序（不是字典序的巧合）", () => {
    expect(practiceAuthorCards(null).map((card) => card.author.id)).toEqual(["a", "b", "c"]);
  });

  it("同一作家多张卡只出最新那张，且不占用别人的垫后位置", () => {
    const cards = practiceAuthorCards([
      practiceBook("new", "c", "2026-10-06T10:00:00Z"),
      practiceBook("old", "c", "2026-10-01T10:00:00Z"),
    ]);
    expect(cards.map((card) => card.workspace?.id ?? null)).toEqual(["new", null, null]);
    expect(cards.map((card) => card.author.id)).toEqual(["c", "a", "b"]);
  });
});
