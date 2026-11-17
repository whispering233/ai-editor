// 关系 metadata 归一测试（单一实现：POST / PUT / propose_add_relation 共用）
// 口径：docs/db/schema.md「关系说明」——label / description 各自 trim、空串删键、非字符串丢弃，
// 其余键原样保留。
import { describe, expect, it } from "vitest";
import { normalizeRelationMetadata } from "./relation-metadata.js";

describe("normalizeRelationMetadata", () => {
  it("label / description 各自 trim", () => {
    expect(normalizeRelationMetadata({ label: "  主弦  ", description: "  第一次交锋 \n" })).toEqual({
      label: "主弦",
      description: "第一次交锋",
    });
  });

  it("空串 / 纯空白删键（整对象清空传 {} 同口径）", () => {
    expect(normalizeRelationMetadata({ label: "", description: "   " })).toEqual({});
    expect(normalizeRelationMetadata({})).toEqual({});
  });

  it("非字符串值丢弃这两键（不打 500、不留脏类型）", () => {
    expect(normalizeRelationMetadata({ label: 42, description: null })).toEqual({});
    expect(normalizeRelationMetadata({ label: ["a"], description: { b: 1 } })).toEqual({});
  });

  it("其余键原样保留（自由袋未被收走）", () => {
    expect(normalizeRelationMetadata({ label: " 标签 ", style: "dashed", weight: 2 })).toEqual({
      label: "标签",
      style: "dashed",
      weight: 2,
    });
  });

  it("非对象输入 → {}", () => {
    expect(normalizeRelationMetadata(undefined)).toEqual({});
    expect(normalizeRelationMetadata(null)).toEqual({});
    expect(normalizeRelationMetadata("label")).toEqual({});
    expect(normalizeRelationMetadata([["label", "x"]])).toEqual({});
    expect(normalizeRelationMetadata(7)).toEqual({});
  });
});
