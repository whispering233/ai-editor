// lib/delta-create 纯函数测试（S12.3；S13.3 收紧：变更目标仅实体类型——DELTA_TARGET_TYPE_OPTIONS
// 不含 outline_node、节点字段选项已删除）：字段选项（实体 schema keys）、op 推断
// （数组 add/remove、标量 set/update）、changes 构造（update 自动 from）、值解析（数字字段）
import { describe, expect, it } from "vitest";
import {
  DELTA_TARGET_TYPE_OPTIONS,
  buildDeltaChange,
  deltaFieldCurrentValue,
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
  it("character：仅可变字段（不可变 role/description 与面板 ability_panel/ custom_fields 不进下拉）+ label + 数组标记", () => {
    const opts = entityDeltaFieldOptions("character");
    expect(opts.map((o) => o.key)).toEqual([
      "alias",
      "gender",
      "age",
      "race",
      "personality",
      "motivation",
    ]);
 // 2026-09（卡片 2.1）：不可变字段不参与 Delta（docs/db/schema.md「人物 data 分层」）
    expect(opts.some((o) => o.key === "role" || o.key === "description")).toBe(false);
    expect(opts.some((o) => o.key === "ability_panel")).toBe(false); // 面板叶子走嵌套路径，整树不进下拉
    expect(opts.some((o) => o.key === "status" || o.key === "abilities")).toBe(false); // 已移除
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

  it("character + 面板：叶子按点分路径展开（前缀 = shared abilityPanelFieldPath；标量；numeric 按当前值类型）", () => {
    const panel = [
      { name: "火系", children: [{ name: "等级", value: 3 }, { name: "熟练度" }] },
    ];
    const opts = entityDeltaFieldOptions("character", panel);
    const keys = opts.map((o) => o.key);
    expect(keys).toContain("ability_panel.火系.等级");
    expect(keys).toContain("ability_panel.火系.熟练度");
    const level = opts.find((o) => o.key === "ability_panel.火系.等级");
    expect(level).toMatchObject({ label: "火系.等级", array: false, numeric: true, panelLeaf: true });
    // 无值的叶子 → 不标 numeric（值输入仍走面板同源解析：`panelLeaf`）
    const proficiency = opts.find((o) => o.key === "ability_panel.火系.熟练度");
    expect(proficiency).toMatchObject({ array: false, numeric: false, panelLeaf: true });
    // 整树仍不进下拉（只有叶子）
    expect(keys).not.toContain("ability_panel");
  });

  it("面板为空/未传/非 character：不追加叶子选项（既有清单不变）", () => {
    expect(entityDeltaFieldOptions("character", [])).toHaveLength(
      entityDeltaFieldOptions("character").length,
    );
    expect(entityDeltaFieldOptions("character", undefined)).toHaveLength(
      entityDeltaFieldOptions("character").length,
    );
    expect(entityDeltaFieldOptions("hook", [{ name: "x" }])).toEqual(entityDeltaFieldOptions("hook"));
  });
});

describe("deltaFieldCurrentValue（update 的 from 来源）", () => {
  it("普通字段取 data 顶层；面板叶子按点分路径从面板里取当前值", () => {
    const data = {
      age: 18,
      ability_panel: [{ name: "火系", children: [{ name: "等级", value: 3 }] }],
    };
    expect(deltaFieldCurrentValue("character", "age", data)).toBe(18);
    expect(deltaFieldCurrentValue("character", "ability_panel.火系.等级", data)).toBe(3);
    // 无值叶子 / 路径未命中 / data 为空 → undefined（update 无旧值可写，表单引导改「设为」）
    expect(deltaFieldCurrentValue("character", "ability_panel.火系.未知", data)).toBeUndefined();
    expect(deltaFieldCurrentValue("character", "ability_panel.火系.等级", null)).toBeUndefined();
    expect(deltaFieldCurrentValue("hook", "status", { status: "planted" })).toBe("planted");
  });
});

describe("isArrayField / isNumericField", () => {
  it("数组字段：character.personality、setting.tags/rules（K2：分类与规则条款均为数组）", () => {
    expect(isArrayField("character", "personality")).toBe(true);
 // 2026-09：abilities 已迁为 ability_panel（面板叶子走嵌套路径，非数组 op）
    expect(isArrayField("character", "ability_panel")).toBe(false);
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
        field: "personality",
        op: "add",
        rawValue: "孤僻",
        numeric: false,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "personality", op: "add", value: "孤僻" },
    });
  });

  it("remove：value 必填（按值匹配删除）", () => {
    expect(
      buildDeltaChange({
        field: "personality",
        op: "remove",
        rawValue: "孤僻",
        numeric: false,
        currentValue: undefined,
      }),
    ).toEqual({
      change: { field: "personality", op: "remove", value: "孤僻" },
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

  it("面板叶子：与面板编辑器同源解析（纯数字 → number；无值叶子不因 numeric=false 而分流）", () => {
    // 有值叶子（numeric=true）与无值叶子（numeric=false）输入 "12" → 均为 number 12
    for (const numeric of [true, false]) {
      expect(
        buildDeltaChange({
          field: "ability_panel.火系.等级",
          op: "set",
          rawValue: "12",
          numeric,
          currentValue: undefined,
          panelLeaf: true,
        }),
      ).toEqual({ change: { field: "ability_panel.火系.等级", op: "set", to: 12 } });
    }
    // 非纯数字文本 → 原样字符串（与面板编辑器同口径）
    expect(
      buildDeltaChange({
        field: "ability_panel.火系.等级",
        op: "set",
        rawValue: "初阶",
        numeric: true,
        currentValue: undefined,
        panelLeaf: true,
      }),
    ).toEqual({ change: { field: "ability_panel.火系.等级", op: "set", to: "初阶" } });
    // 面板编辑器不支持的字面（指数/十六进制/前导 +）→ 文本（与 coerceAbilityValue 同源）
    for (const raw of ["1e3", "0x10", "+5"]) {
      expect(
        buildDeltaChange({
          field: "ability_panel.火系.等级",
          op: "set",
          rawValue: raw,
          numeric: true,
          currentValue: undefined,
          panelLeaf: true,
        }),
      ).toEqual({ change: { field: "ability_panel.火系.等级", op: "set", to: raw } });
    }
    // update：from 取自目标当前值（面板叶子路径解析），to 同源解析
    expect(
      buildDeltaChange({
        field: "ability_panel.火系.等级",
        op: "update",
        rawValue: "5",
        numeric: true,
        currentValue: 3,
        panelLeaf: true,
      }),
    ).toEqual({ change: { field: "ability_panel.火系.等级", op: "update", from: 3, to: 5 } });
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
