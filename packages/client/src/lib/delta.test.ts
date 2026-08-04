// lib/delta 纯函数测试（S5.4）：describeChange 四 op 摘要 / formatDeltaValue 边界 /
//   targetTypeLabel 映射 / diffStateFields 状态差异
import { describe, expect, it } from "vitest";
import type { DeltaChange } from "@whispering233/ai-editor-shared";
import { describeChange, diffStateFields, formatDeltaValue, targetTypeLabel } from "./delta";

describe("describeChange（op/field/from→to 紧凑摘要）", () => {
  it("update：field from → to", () => {
    const c: DeltaChange = { field: "combat_power", op: "update", from: "100", to: "150" };
    expect(describeChange(c)).toBe("combat_power 100 → 150");
  });

  it("set：field = to（to 为数字）", () => {
    const c: DeltaChange = { field: "status", op: "set", to: "resolved" };
    expect(describeChange(c)).toBe("status = resolved");
  });

  it("add：field +value（value 优先，to 兜底）", () => {
    expect(describeChange({ field: "abilities", op: "add", value: "御剑" })).toBe("abilities +御剑");
    expect(describeChange({ field: "abilities", op: "add", to: "火球术" })).toBe("abilities +火球术");
  });

  it("remove：field -value", () => {
    expect(describeChange({ field: "abilities", op: "remove", value: "御剑" })).toBe("abilities -御剑");
  });

  it("null 值 → 「空」", () => {
    expect(describeChange({ field: "name", op: "update", from: null, to: "新名" })).toBe("name 空 → 新名");
  });
});

describe("formatDeltaValue", () => {
  it("null/undefined → 「空」", () => {
    expect(formatDeltaValue(null)).toBe("空");
    expect(formatDeltaValue(undefined)).toBe("空");
  });

  it("对象/数组 JSON 化", () => {
    expect(formatDeltaValue(["a", "b"])).toBe('["a","b"]');
  });

  it("字符串/数字原样", () => {
    expect(formatDeltaValue("150")).toBe("150");
    expect(formatDeltaValue(150)).toBe("150");
  });
});

describe("targetTypeLabel", () => {
  it("四类实体与大纲节点 → 中文", () => {
    expect(targetTypeLabel("character")).toBe("人物");
    expect(targetTypeLabel("setting")).toBe("设定");
    expect(targetTypeLabel("location")).toBe("地点");
    expect(targetTypeLabel("hook")).toBe("伏笔");
    expect(targetTypeLabel("outline_node")).toBe("大纲节点");
  });

  it("未知类型原样显示", () => {
    expect(targetTypeLabel("weird_type")).toBe("weird_type");
  });
});

describe("diffStateFields（compute state vs 当前 data）", () => {
  it("值变化 → 差异条目（有序，原 data 键序优先）", () => {
    const diffs = diffStateFields(
      { name: "张三", combat_power: 100, status: "active" },
      { name: "张三", combat_power: 850, status: "active" },
    );
    expect(diffs).toEqual([{ field: "combat_power", from: 100, to: 850 }]);
  });

  it("无差异 → 空数组", () => {
    expect(diffStateFields({ a: 1, b: ["x"] }, { a: 1, b: ["x"] })).toEqual([]);
  });

  it("计算态新增字段 → from undefined（展示「（无）」）", () => {
    const diffs = diffStateFields({ a: 1 }, { a: 1, b: 2 });
    expect(diffs).toEqual([{ field: "b", from: undefined, to: 2 }]);
  });

  it("当前态独有字段 → to undefined（展示「（已移除）」）", () => {
    const diffs = diffStateFields({ a: 1, b: 2 }, { a: 1 });
    expect(diffs).toEqual([{ field: "b", from: 2, to: undefined }]);
  });

  it("undefined 与缺失等价（null 归一比较）", () => {
    expect(diffStateFields({ a: undefined }, {})).toEqual([]);
    expect(diffStateFields({ a: null }, {})).toEqual([]);
  });
});
