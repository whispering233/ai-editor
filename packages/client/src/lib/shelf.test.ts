// 书架行判定纯函数（卡 23.5）：当前书只按项目 id 判。
// 为什么单测纯函数而不是渲 Dashboard——client 无 jsdom，zustand 的 SSR 快照读不到预置书架。
import { describe, expect, it } from "vitest";
import { isCurrentBook } from "./shelf";

// 当前书判定（卡 23.5 抽为纯函数；卡 23.2 oracle 登记的防御用例随结构改造一并落地）：
// 「已打开 / 高亮」的判据只能是**项目 id**——按书名会在同名不同 id 的书并存时高亮错行。
describe("isCurrentBook", () => {
  const book = {
    id: "proj-1",
    name: "同名书",
    path: "/root/books/同名书",
    updatedAt: "2026-09-01T10:00:00Z",
  };

  it("同 id → 当前书", () => {
    expect(isCurrentBook(book, { id: "proj-1" })).toBe(true);
  });

  it("id 不匹配即不高亮——即使 name 相同（同名不同 id 并存）", () => {
    expect(isCurrentBook(book, { id: "proj-2" })).toBe(false);
    // 行为级：另一本同名书也不是当前书（不是「name 相等就算」，是 id 相等才算）
    expect(isCurrentBook({ ...book, id: "proj-2" }, { id: "proj-1" })).toBe(false);
  });

  it("未打开任何书（config = null）→ 无行高亮", () => {
    expect(isCurrentBook(book, null)).toBe(false);
  });
});
