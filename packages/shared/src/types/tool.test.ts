// 工具参数 schema 测试（G2）：propose_reorder_timepoints 入参形状校验
// 覆盖：正常通过 / 非数组拒绝 / 空数组拒绝 / 超 200 拒绝（时间点量上限与列表 limit 对齐）/
//   未知键拒绝（.strict()）/ 元素非字符串拒绝
import { describe, expect, it } from "vitest";
import { proposeReorderTimepointsArgsSchema } from "./tool.js";

describe("proposeReorderTimepointsArgsSchema（G2，时间点量上限 200 与列表 limit 对齐）", () => {
  it("正常：非空时间点 id 数组通过，顺序保留", () => {
    const parsed = proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: ["tp-3", "tp-1", "tp-2"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.timepoint_ids).toEqual(["tp-3", "tp-1", "tp-2"]);
  });

  it("200 个时间点为上限边界：200 通过、201 拒绝", () => {
    const atLimit = proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: Array.from({ length: 200 }, (_, i) => `tp-${i}`) });
    expect(atLimit.success).toBe(true);
    const overLimit = proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: Array.from({ length: 201 }, (_, i) => `tp-${i}`) });
    expect(overLimit.success).toBe(false);
  });

  it("非数组 / 空数组拒绝", () => {
    expect(proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: "tp-1" }).success).toBe(false);
    expect(proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: [] }).success).toBe(false);
  });

  it("元素非字符串拒绝", () => {
    expect(proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: ["tp-1", 42] }).success).toBe(false);
  });

  it("未知键拒绝（.strict() 与既有提案工具 schema 同款）", () => {
    expect(proposeReorderTimepointsArgsSchema.safeParse({ timepoint_ids: ["tp-1"], extra: 1 }).success).toBe(false);
  });
});
