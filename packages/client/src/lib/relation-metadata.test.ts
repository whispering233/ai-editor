// 关系说明 payload 构造测试：metadata 是**整体替换**，丢键 = 静默删数据（docs/api/40-api-relation.md PUT 段）。
import { describe, expect, it } from "vitest";
import { buildRelationMetadataPayload, relationMetadataDraft } from "./relation-metadata";

describe("buildRelationMetadataPayload", () => {
  it("保留 base 里的其它键（自由袋未被收走）", () => {
    expect(
      buildRelationMetadataPayload(
        { label: "旧标签", description: "旧说明", style: "dashed", weight: 2 },
        { label: "师徒反目", description: "第一次交锋" },
      ),
    ).toEqual({ label: "师徒反目", description: "第一次交锋", style: "dashed", weight: 2 });
  });

  it("label / description 各自 trim", () => {
    expect(
      buildRelationMetadataPayload(undefined, { label: "  主公  ", description: "  誓约\n" }),
    ).toEqual({ label: "主公", description: "誓约" });
  });

  it("空串原样发（删键口径属服务端 normalizeRelationMetadata）", () => {
    expect(buildRelationMetadataPayload({}, { label: "", description: "  " })).toEqual({
      label: "",
      description: "",
    });
  });

  it("base 为 undefined → 只含两个约定键", () => {
    expect(buildRelationMetadataPayload(undefined, { label: "a", description: "b" })).toEqual({
      label: "a",
      description: "b",
    });
  });
});

describe("relationMetadataDraft", () => {
  it("缺键 / 非字符串值 → 空串", () => {
    expect(relationMetadataDraft(undefined)).toEqual({ label: "", description: "" });
    expect(relationMetadataDraft({ label: 42, description: null })).toEqual({
      label: "",
      description: "",
    });
  });

  it("存量值原样回填", () => {
    expect(relationMetadataDraft({ label: "师徒", description: "反目" })).toEqual({
      label: "师徒",
      description: "反目",
    });
  });
});
