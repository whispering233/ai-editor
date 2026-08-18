// datalist 辅助测试（批次五 J2，决策 31）：uniqueStrings 聚合去重
import { describe, expect, it } from "vitest";
import { uniqueStrings } from "./suggestion-datalist";

describe("uniqueStrings（datalist 候选聚合）", () => {
  it("去重 + 保序 + 过滤空串/非字符串", () => {
    expect(uniqueStrings(["势力", "势力", "宗门", "", undefined])).toEqual(["势力", "宗门"]);
  });

  it("空输入 → 空数组", () => {
    expect(uniqueStrings([])).toEqual([]);
    expect(uniqueStrings(["", undefined])).toEqual([]);
  });
});
