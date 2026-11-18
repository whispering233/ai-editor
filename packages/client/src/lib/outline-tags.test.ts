// 大纲标签读侧窄化 + 预览条数（DESIGN.md `data-row`「章行的第三行」/ `tag`）：
// 窄化口径 = 非数组 → 空、只留非空字符串（不 trim / 不去重）；预览固定前 N 个 + 溢出计数。
import { describe, expect, it } from "vitest";
import {
  OUTLINE_TAG_PREVIEW_LIMIT,
  outlineTagsFromData,
  previewOutlineTags,
} from "./outline-tags";

describe("outlineTagsFromData", () => {
  it("无 data / data 无 tags / tags 非数组 → []", () => {
    expect(outlineTagsFromData(undefined)).toEqual([]);
    expect(outlineTagsFromData(null)).toEqual([]);
    expect(outlineTagsFromData({})).toEqual([]);
    expect(outlineTagsFromData({ tags: "复仇" })).toEqual([]);
    expect(outlineTagsFromData({ tags: { 0: "复仇" } })).toEqual([]);
  });

  it("只留非空字符串：非字符串元素与空串丢弃，不改写 / 不去重", () => {
    expect(outlineTagsFromData({ tags: ["复仇", "", 42, null, " 成长线 ", "复仇"] })).toEqual([
      "复仇",
      " 成长线 ",
      "复仇",
    ]);
  });
});

describe("previewOutlineTags", () => {
  it("0 / 1 / 2 个：全部可见、无溢出", () => {
    expect(previewOutlineTags([])).toEqual({ visible: [], overflow: 0 });
    expect(previewOutlineTags(["a"])).toEqual({ visible: ["a"], overflow: 0 });
    expect(previewOutlineTags(["a", "b"])).toEqual({ visible: ["a", "b"], overflow: 0 });
  });

  it(`${OUTLINE_TAG_PREVIEW_LIMIT} 个以上：只给前 ${OUTLINE_TAG_PREVIEW_LIMIT} 个 + 溢出计数`, () => {
    expect(previewOutlineTags(["a", "b", "c"])).toEqual({ visible: ["a", "b"], overflow: 1 });
    expect(previewOutlineTags(["a", "b", "c", "d", "e"])).toEqual({
      visible: ["a", "b"],
      overflow: 3,
    });
  });
});
