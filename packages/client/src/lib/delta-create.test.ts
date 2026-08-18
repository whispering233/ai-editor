// lib/delta-create 纯函数测试（S12.3；S13.3 收紧：变更目标仅实体类型——DELTA_TARGET_TYPE_OPTIONS
//   不含 outline_node、节点字段选项已删除）：字段选项（实体 schema keys）、op 推断
//   （数组 add/remove、标量 set/update）、changes 构造（update 自动 from）、值解析（数字字段）
import { describe, expect, it } from "vitest";
import {
  DELTA_TARGET_TYPE_OPTIONS,
  buildDeltaChange,
  entityDeltaFieldOptions,
  inferOpOptions,
  isArrayField,
  isNumericField,
  resolvableFromValue,
} from "./delta-create";

describe("DELTA_TARGET_TYPE_OPTIONS（S13.3 收紧：仅实体类型）", () => {
  it("四类实体齐备（character/setting/location/hook）", () => {
    expect(DELTA_TARGET_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "character",
      "setting",
      "location",
      "hook",
    ]);
    expect(DELTA_TARGET_TYPE_OPTIONS.map((o) => o.label)).toEqual(["人物", "设定", "地点", "伏笔"]);
  });

  it("不含 outline_node（大纲节点不可作为变更目标——历史数据展示保留，创建路径收紧）", () => {
    expect(DELTA_TARGET_TYPE_OPTIONS.some((o) => o.value === "outline_node")).toBe(false);
  });
});

describe("entityDeltaFieldOptions（字段名 = shared ENTITY_DATA_SCHEMAS keys，编译期断言）", () => {
  it("character：全量字段（除 custom_fields）+ label + 数组标记", () => {
    const opts = entityDeltaFieldOptions("character");
    expect(opts.map((o) => o.key)).toEqual([
      "role",
      "gender",
      "age",
      "personality",
      "motivation",
      "abilities",
      "status",
    ]);
    const personality = opts.find((o) => o.key === "personality");
    expect(personality).toMatchObject({ label: "性格", array: true });
    const age = opts.find((o) => o.key === "age");
    expect(age).toMatchObject({ label: "年龄", array: false });
  });

  it("hook：无 custom_fields（schema 不含该键，编译期断言已保证）", () => {
    const opts = entityDeltaFieldOptions("hook");
    expect(opts.some((o) => o.key === "custom_fields")).toBe(false);
    expect(opts.some((o) => o.key === "half_life")).toBe(true);
  });

  it("未知类型 → 空数组", () => {
    expect(entityDeltaFieldOptions("unknown_type")).toEqual([]);
  });
});

describe("isArrayField / isNumericField", () => {
  it("数组字段：character.personality/abilities、setting.tags/rules（K2：分类与规则条款均为数组）", () => {
    expect(isArrayField("character", "personality")).toBe(true);
    expect(isArrayField("character", "abilities")).toBe(true);
    expect(isArrayField("setting", "tags")).toBe(true);
    expect(isArrayField("setting", "rules")).toBe(true);
    expect(isArrayField("scene", "conflict_levels")).toBe(false);
    expect(isArrayField("character", "role")).toBe(false);
  });

  it("数字字段：character.age、hook.half_life；未知类型安全", () => {
    expect(isNumericField("character", "age")).toBe(true);
    expect(isNumericField("hook", "half_life")).toBe(true);
    expect(isNumericField("character", "role")).toBe(false);
    expect(isNumericField("unknown", "age")).toBe(false);
  });
});

describe("resolvableFromValue（update 自动 from 的可表达性）", () => {
  it("string/number 原值；null → null（「旧值：空」）", () => {
    expect(resolvableFromValue("活跃")).toBe("活跃");
    expect(resolvableFromValue(150)).toBe(150);
    expect(resolvableFromValue(null)).toBe(null);
  });

  it("undefined/boolean/数组/对象 → 不可表达（undefined）", () => {
    expect(resolvableFromValue(undefined)).toBeUndefined();
    expect(resolvableFromValue(true)).toBeUndefined();
    expect(resolvableFromValue(["a"])).toBeUndefined();
    expect(resolvableFromValue({ a: 1 })).toBeUndefined();
  });
});

describe("inferOpOptions（op 推断）", () => {
  it("数组字段 → [add, remove] 默认 add", () => {
    expect(inferOpOptions({ array: true, currentValue: undefined })).toEqual({
      options: ["add", "remove"],
      default: "add",
    });
  });

  it("标量 + 当前值可作 from → [update, set] 默认 update", () => {
    expect(inferOpOptions({ array: false, currentValue: "活跃" })).toEqual({
      options: ["update", "set"],
      default: "update",
    });
  });

  it("标量 + 值不可作 from（字段缺失/布尔）→ 仅 [set]", () => {
    expect(inferOpOptions({ array: false, currentValue: undefined })).toEqual({
      options: ["set"],
      default: "set",
    });
    expect(inferOpOptions({ array: false, currentValue: true })).toEqual({
      options: ["set"],
      default: "set",
    });
  });
});

describe("buildDeltaChange（per-op 必填语义 + update 自动 from）", () => {
  it("add：value 必填", () => {
    expect(
      buildDeltaChange({
        field: "abilities",
        op: "add",
        rawValue: "御剑",
        numeric: false,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "abilities", op: "add", value: "御剑" },
    });
  });

  it("remove：value 必填（按值匹配删除）", () => {
    expect(
      buildDeltaChange({
        field: "abilities",
        op: "remove",
        rawValue: "御剑",
        numeric: false,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "abilities", op: "remove", value: "御剑" },
    });
  });

  it("set：to = 解析后的值", () => {
    expect(
      buildDeltaChange({
        field: "status",
        op: "set",
        rawValue: "中立",
        numeric: false,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "status", op: "set", to: "中立" },
    });
  });

  it("update：from 自动取当前值（作者无需手填）", () => {
    expect(
      buildDeltaChange({
        field: "status",
        op: "update",
        rawValue: "中立",
        numeric: false,
        currentValue: "活跃",
      }),
    ).toEqual({ change: { field: "status", op: "update", from: "活跃", to: "中立" } });
  });

  it("update：当前值为 null → from 为 null（「旧值：空」可写）", () => {
    expect(
      buildDeltaChange({
        field: "status",
        op: "update",
        rawValue: "中立",
        numeric: false,
        currentValue: null,
      }),
    ).toEqual({
      change: { field: "status", op: "update", from: null, to: "中立" },
    });
  });

  it("update：当前值不可表达 → 报错引导改「设为」", () => {
    expect(
      buildDeltaChange({
        field: "is_core",
        op: "update",
        rawValue: "true",
        numeric: false,
        currentValue: false,
      }),
    ).toEqual({
      error: expect.stringContaining("无法确定旧值"),
    });
  });

  it("数字字段解析为 number；非数字输入回退字符串", () => {
    expect(
      buildDeltaChange({
        field: "age",
        op: "set",
        rawValue: "16",
        numeric: true,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "age", op: "set", to: 16 },
    });
    expect(
      buildDeltaChange({
        field: "age",
        op: "set",
        rawValue: "十六",
        numeric: true,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "age", op: "set", to: "十六" },
    });
  });

  it("空值 → 报错", () => {
    expect(
      buildDeltaChange({
        field: "status",
        op: "set",
        rawValue: "  ",
        numeric: false,
        currentValue: undefined,
      }),
    ).toEqual({
      error: "请填写值",
    });
  });
});
