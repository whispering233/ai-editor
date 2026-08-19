// 可搜索下拉过滤辅助测试（批次八 O1，2026-08）：filterOptions 客户端候选过滤
import { describe, expect, it } from "vitest";
import { filterOptions, type SearchableSelectOption } from "./searchable-select";

const OPTIONS: SearchableSelectOption[] = [
  { value: "set-1", label: "修真界" },
  { value: "set-2", label: "灵界大陆" },
  { value: "set-3", label: "宗门" },
  { value: "set-4", label: "Map 地图" },
];

describe("filterOptions（候选关键词过滤）", () => {
  it("空 q（含纯空白）→ 全量副本", () => {
    expect(filterOptions(OPTIONS, "")).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, "   ")).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, "")).not.toBe(OPTIONS); // 返回副本，不引用原数组
  });

  it("大小写不敏感匹配 label", () => {
    expect(filterOptions(OPTIONS, "修")).toEqual([{ value: "set-1", label: "修真界" }]);
    expect(filterOptions(OPTIONS, "MAP")).toEqual([{ value: "set-4", label: "Map 地图" }]);
    expect(filterOptions(OPTIONS, "map")).toEqual([{ value: "set-4", label: "Map 地图" }]);
    expect(filterOptions(OPTIONS, "界")).toHaveLength(2); // 修真界 / 灵界大陆
  });

  it("trim 后再匹配（首尾空白忽略）", () => {
    expect(filterOptions(OPTIONS, "  宗  ")).toEqual([{ value: "set-3", label: "宗门" }]);
  });

  it("无匹配 → 空数组", () => {
    expect(filterOptions(OPTIONS, "不存在")).toEqual([]);
  });

  it("空候选数组 → 空数组", () => {
    expect(filterOptions([], "x")).toEqual([]);
    expect(filterOptions([], "")).toEqual([]);
  });
});
