// bookCoverHue 纯函数测试（S1.6）：同名同值、不同名分布、值域、空串边界
import { describe, expect, it } from "vitest";
import { bookCoverHue } from "./book-cover";

describe("bookCoverHue（封面占位色相派生）", () => {
  it("同名同值：同一书名多次调用结果一致（稳定，UI 同书同色）", () => {
    expect(bookCoverHue("我的小说")).toBe(bookCoverHue("我的小说"));
    expect(bookCoverHue("修仙：从灵根开始")).toBe(bookCoverHue("修仙：从灵根开始"));
  });

  it("不同名分布：常见书名两两色相不同（卡片网格不撞色）", () => {
    const names = ["我的小说", "修仙：从灵根开始", "长安夜雨", "灰烬与黎明", "流浪的月亮"];
    const hues = names.map((n) => bookCoverHue(n));
    expect(new Set(hues).size).toBe(names.length);
  });

  it("值域：0 ≤ hue < 360（供 hsl() 使用）", () => {
    for (const name of ["a", "我的小说", "很长的书名".repeat(10)]) {
      const hue = bookCoverHue(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it("空串边界：不抛错、返回 0（UI 层书名非空，此为兜底）", () => {
    expect(bookCoverHue("")).toBe(0);
  });

  it("纯函数：与调用顺序、外部状态无关", () => {
    const first = bookCoverHue("长安夜雨");
    const second = bookCoverHue("长安夜雨");
    expect(first).toBe(second);
  });
});
