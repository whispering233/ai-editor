// 书架分组纯函数（卡 23.2）：组序固定 / 空组不渲染 / 组内保持传入顺序。
// 为什么单测纯函数而不是渲 Dashboard——client 无 jsdom，zustand 的 SSR 快照读不到预置书架
//（pages/dashboard-decompose.test.ts 顶部有同款说明）。
import { describe, expect, it } from "vitest";
import type { ProjectListBook } from "@whispering233/ai-editor-shared";
import { groupShelfBooks } from "./shelf";

function book(id: string, origin: ProjectListBook["origin"]): ProjectListBook {
  return { id, name: id, path: `/root/books/${id}`, origin, updatedAt: "2026-09-01T10:00:00Z" };
}

describe("groupShelfBooks", () => {
  it("固定组序 [小说项目, 小说拆解]：交错传入也按组归位", () => {
    const groups = groupShelfBooks([book("拆1", "decompose"), book("书1", "book"), book("拆2", "decompose")]);
    expect(groups.map((g) => g.origin)).toEqual(["book", "decompose"]);
    expect(groups.map((g) => g.label)).toEqual(["小说项目", "小说拆解"]);
    expect(groups[0].books.map((b) => b.id)).toEqual(["书1"]);
    expect(groups[1].books.map((b) => b.id)).toEqual(["拆1", "拆2"]);
  });

  it("组内保持传入顺序（倒序排序归服务端，前端不再排）", () => {
    expect(groupShelfBooks([book("b2", "book"), book("b1", "book")])[0].books.map((b) => b.id)).toEqual([
      "b2",
      "b1",
    ]);
  });

  it("空组不渲染：只有一类书 → 只返回一组（只有一类书时就是一张列表）", () => {
    expect(groupShelfBooks([book("书1", "book")]).map((g) => g.label)).toEqual(["小说项目"]);
    expect(groupShelfBooks([book("拆1", "decompose")]).map((g) => g.label)).toEqual(["小说拆解"]);
  });

  it("空书架 → 空数组", () => {
    expect(groupShelfBooks([])).toEqual([]);
  });
});
