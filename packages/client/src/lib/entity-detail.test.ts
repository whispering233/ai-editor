// entity-detail 纯函数与配置测试（S3.6）：按类型字段配置、关系类型中文映射、表单 diff
import { describe, expect, it } from "vitest";
import { detailFieldsForType, diffData, relationTypeLabel } from "./entity-detail";

describe("detailFieldsForType（data 表单按类型配置——schema.md 字段清单）", () => {
  it("character：role/gender/age/personality/motivation/abilities/status，控件类型正确", () => {
    const fields = detailFieldsForType("character");
    expect(fields.map((f) => f.key)).toEqual([
      "role", "gender", "age", "personality", "motivation", "abilities", "status",
    ]);
    expect(fields.find((f) => f.key === "age")?.control).toBe("number");
    expect(fields.find((f) => f.key === "personality")?.control).toBe("tags");
    expect(fields.find((f) => f.key === "motivation")?.control).toBe("textarea");
  });

  it("setting/location：category/parent_id/description(+rules)，parent_id 为文本", () => {
    expect(detailFieldsForType("setting").map((f) => f.key)).toEqual([
      "category", "parent_id", "description", "rules",
    ]);
    expect(detailFieldsForType("location").map((f) => f.key)).toEqual([
      "type", "parent_id", "description",
    ]);
  });

  it("hook：status/payoff_timing 受控枚举下拉，expected_resolve_node_id 大纲节点选择器，is_core 开关", () => {
    const fields = detailFieldsForType("hook");
    const status = fields.find((f) => f.key === "status")!;
    expect(status.control).toBe("select");
    expect(status.options).toEqual(["planted", "progressing", "resolved", "abandoned"]);
    expect(fields.find((f) => f.key === "payoff_timing")?.options).toEqual([
      "immediate", "near_term", "mid_arc", "slow_burn", "endgame",
    ]);
    expect(fields.find((f) => f.key === "expected_resolve_node_id")?.control).toBe("outline-node");
    expect(fields.find((f) => f.key === "is_core")?.control).toBe("toggle");
    expect(fields.find((f) => f.key === "half_life")?.control).toBe("number");
  });
});

describe("relationTypeLabel（16 种预定义关系类型中文映射）", () => {
  it("核心映射：mentor→师徒、appears_in→出现于、masters→掌握、ally→盟友", () => {
    expect(relationTypeLabel("mentor")).toBe("师徒");
    expect(relationTypeLabel("appears_in")).toBe("出现于");
    expect(relationTypeLabel("masters")).toBe("掌握");
    expect(relationTypeLabel("ally")).toBe("盟友");
    expect(relationTypeLabel("plot_edge")).toBe("剧情连线");
    expect(relationTypeLabel("plants")).toBe("埋设");
  });

  it("未知类型原样显示（不崩溃）", () => {
    expect(relationTypeLabel("custom_rel")).toBe("custom_rel");
  });
});

describe("diffData（表单 partial 提交——只返回变更字段）", () => {
  const original = { role: "主角", age: 16, abilities: ["火球术"], status: "活跃" };

  it("无变更 → null（不发请求）", () => {
    expect(diffData(original, { ...original })).toBeNull();
  });

  it("单字段变更 → 只含该字段", () => {
    expect(diffData(original, { ...original, status: "退场" })).toEqual({ status: "退场" });
  });

  it("数组字段比较（JSON 深度比较）：增删元素识别为变更", () => {
    expect(diffData(original, { ...original, abilities: ["火球术", "御剑"] })).toEqual({
      abilities: ["火球术", "御剑"],
    });
    expect(diffData(original, { ...original, abilities: [] })).toEqual({ abilities: [] });
  });

  it("空值规约：空串/空数组与缺失等价（清空字段不产生无意义提交）", () => {
    expect(diffData(original, { ...original, role: "" })).toEqual({ role: "" });
    // 原值已是空串时，清空不提交
    expect(diffData({ role: "" }, { role: "" })).toBeNull();
    expect(diffData({ abilities: [] }, { abilities: [] })).toBeNull();
  });

  it("新增字段识别（form 含 original 没有的键）", () => {
    expect(diffData({ role: "主角" }, { role: "主角", gender: "男" })).toEqual({ gender: "男" });
  });

  it("数字与字符串区分：age 数字 vs 字符串视为变更", () => {
    expect(diffData(original, { ...original, age: "16" })).toEqual({ age: "16" });
  });

  it("form 值为 undefined 的键跳过不提交（数字控件清空——age/half_life 不产生 age:null 导致 400）", () => {
    // 清空数字：undefined 键被跳过，diff 结果为 null（保留服务端原值）
    expect(diffData({ age: 16 }, { age: undefined })).toBeNull();
    expect(diffData(original, { ...original, age: undefined })).toBeNull();
    // 其他字段的变更不受影响（undefined 键被排除，不混入提交）
    expect(diffData(original, { ...original, age: undefined, status: "退场" })).toEqual({ status: "退场" });
  });

  it("null 正常提交（expected_resolve_node_id 清空——「未设置」存 null 而非空串，决策 21）", () => {
    // 原值有节点 → 清空 → 提交 null（服务端 z.string().nullable() 接受）
    expect(diffData({ expected_resolve_node_id: "sc-1" }, { expected_resolve_node_id: null })).toEqual({
      expected_resolve_node_id: null,
    });
    // 原值本就无该键 + null → 无变更
    expect(diffData({}, { expected_resolve_node_id: null })).toBeNull();
    // 空串与 null 比较等价（同「未设置」语义）——旧值空串清空不产生提交
    expect(diffData({ expected_resolve_node_id: "" }, { expected_resolve_node_id: null })).toBeNull();
  });
});
