// 工具参数 schema 测试（F9 起）：propose_reorder_events 入参形状校验
// 覆盖：正常通过 / 非数组拒绝 / 空数组拒绝 / 超 200 拒绝（事件量上限与列表 limit 对齐）/
//   未知键拒绝（.strict()）/ 元素非字符串拒绝
import { describe, expect, it } from "vitest";
import { proposeReorderEventsArgsSchema } from "./tool.js";

describe("proposeReorderEventsArgsSchema（F9，事件量上限 200 与列表 limit 对齐）", () => {
  it("正常：非空事件 id 数组通过，顺序保留", () => {
    const parsed = proposeReorderEventsArgsSchema.safeParse({ event_ids: ["ev-3", "ev-1", "ev-2"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.event_ids).toEqual(["ev-3", "ev-1", "ev-2"]);
  });

  it("200 个事件为上限边界：200 通过、201 拒绝", () => {
    const atLimit = proposeReorderEventsArgsSchema.safeParse({ event_ids: Array.from({ length: 200 }, (_, i) => `ev-${i}`) });
    expect(atLimit.success).toBe(true);
    const overLimit = proposeReorderEventsArgsSchema.safeParse({ event_ids: Array.from({ length: 201 }, (_, i) => `ev-${i}`) });
    expect(overLimit.success).toBe(false);
  });

  it("非数组 / 空数组拒绝", () => {
    expect(proposeReorderEventsArgsSchema.safeParse({ event_ids: "ev-1" }).success).toBe(false);
    expect(proposeReorderEventsArgsSchema.safeParse({ event_ids: [] }).success).toBe(false);
  });

  it("元素非字符串拒绝", () => {
    expect(proposeReorderEventsArgsSchema.safeParse({ event_ids: ["ev-1", 42] }).success).toBe(false);
  });

  it("未知键拒绝（.strict() 与既有提案工具 schema 同款）", () => {
    expect(proposeReorderEventsArgsSchema.safeParse({ event_ids: ["ev-1"], extra: 1 }).success).toBe(false);
  });
});
