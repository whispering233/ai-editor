// 能力面板纯函数库测试（卡片 2.5）
// 覆盖：结构不变式（分支/叶子、children:[] 归一）、防御解析（坏 JSON 不抛错）、
// 叶子路径（先序 + 点分 + 含 `.` 边界）、模板派生深拷贝独立性、值类型判定。
import { describe, expect, it } from "vitest";
import type { AbilityPanelNode } from "../types/ability-panel.js";
import {
  cloneAbilityPanel,
  coerceAbilityValue,
  isAbilityBranch,
  panelLeafPaths,
  panelTopLevelNames,
  parseAbilityPanel,
} from "./ability-panel.js";

/** 三层样例面板（分支/叶子混合 + 空值叶子） */
const PANEL: AbilityPanelNode[] = [
  {
    name: "火系",
    children: [
      { name: "等级", value: 3 },
      { name: "熟练度" },
      { name: "奥义", children: [{ name: "焚天", value: "初成" }] },
    ],
  },
  { name: "境界", value: "筑基三层" },
];

describe("parseAbilityPanel —— 结构与规范形状", () => {
  it("合法面板原样解析（顺序 = 数组顺序），分支不携带 value", () => {
    const parsed = parseAbilityPanel([
      { name: "火系", value: 999, children: [{ name: "等级", value: 3 }] },
      { name: "境界", value: "筑基三层" },
    ]);
    expect(parsed).toEqual([
      { name: "火系", children: [{ name: "等级", value: 3 }] }, // 分支上的 value 被丢弃
      { name: "境界", value: "筑基三层" },
    ]);
  });

  it("children: [] 与非数组 children → 均归一为叶子（分支 ⇔ 非空 children 数组）", () => {
    const parsed = parseAbilityPanel([
      { name: "空分组", children: [] },
      { name: "坏 children", children: "not-array" },
    ]);
    expect(parsed).toEqual([{ name: "空分组" }, { name: "坏 children" }]);
    expect(isAbilityBranch(parsed[0])).toBe(false);
    expect(isAbilityBranch(parsed[1])).toBe(false);
  });

  it("空 children 归一后保留原 value（降级为叶子的节点可赋值）", () => {
    expect(parseAbilityPanel([{ name: "等级", value: 3, children: [] }])).toEqual([{ name: "等级", value: 3 }]);
  });

  it("嵌套 ≥3 层结构完整保留", () => {
    const parsed = parseAbilityPanel(PANEL);
    expect(parsed).toEqual(PANEL);
    expect(panelLeafPaths(parsed).map((leaf) => leaf.path)).toEqual([
      "火系.等级",
      "火系.熟练度",
      "火系.奥义.焚天",
      "境界",
    ]);
  });

  it("未知键丢弃（返回规范形状）", () => {
    expect(parseAbilityPanel([{ name: "等级", value: 3, note: "注释", children: [] }])).toEqual([
      { name: "等级", value: 3 },
    ]);
  });

  it("不修改入参（深层对象与数组均不被就地改写）", () => {
    const input = structuredClone(PANEL);
    const snapshot = structuredClone(input);
    parseAbilityPanel(input);
    expect(input).toEqual(snapshot);
  });
});

describe("parseAbilityPanel —— 防御（坏 JSON 不抛错）", () => {
  it("非数组输入 → 空面板", () => {
    for (const bad of [null, undefined, 42, "x", { name: "火系" }, true]) {
      expect(parseAbilityPanel(bad)).toEqual([]);
    }
  });

  it("坏元素跳过、合法元素保留", () => {
    const parsed = parseAbilityPanel([
      null,
      "字符串",
      42,
      [],
      {},
      { name: 42 },
      { name: "" },
      { name: "   " },
      { name: "等级", value: 3 },
    ]);
    expect(parsed).toEqual([{ name: "等级", value: 3 }]);
  });

  it("叶子 value 仅接受 string / 有限 number，其余视为缺省", () => {
    const parsed = parseAbilityPanel([
      { name: "a", value: null },
      { name: "b", value: Number.NaN },
      { name: "c", value: Number.POSITIVE_INFINITY },
      { name: "d", value: {} },
      { name: "e", value: true },
      { name: "f", value: "12" },
    ]);
    expect(parsed).toEqual([{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }, { name: "e" }, { name: "f", value: "12" }]);
  });

  it("数字串不做类型判定（parse 保留原文，判定归 coerceAbilityValue / UI 输入时）", () => {
    expect(parseAbilityPanel([{ name: "等级", value: "12" }])).toEqual([{ name: "等级", value: "12" }]);
  });

  it("坏子树整体跳过不影响兄弟节点", () => {
    expect(parseAbilityPanel([{ name: "火系", children: [null, { name: "等级", value: 3 }, "x"] }])).toEqual([
      { name: "火系", children: [{ name: "等级", value: 3 }] },
    ]);
  });
});

describe("isAbilityBranch", () => {
  it("非空 children → true；无 children / 空数组 → false", () => {
    expect(isAbilityBranch({ name: "a", children: [{ name: "b" }] })).toBe(true);
    expect(isAbilityBranch({ name: "a" })).toBe(false);
    expect(isAbilityBranch({ name: "a", children: [] })).toBe(false);
    expect(isAbilityBranch({ name: "a", value: 1 })).toBe(false);
  });
});

describe("panelTopLevelNames", () => {
  it("顺序 = 数组顺序，不去重", () => {
    expect(panelTopLevelNames(PANEL)).toEqual(["火系", "境界"]);
    expect(panelTopLevelNames([{ name: "火系" }, { name: "火系" }])).toEqual(["火系", "火系"]);
    expect(panelTopLevelNames([])).toEqual([]);
  });
});

describe("panelLeafPaths", () => {
  it("先序遍历序 + 点分路径 + 空值叶子保留（value 缺省不出现该键）", () => {
    const leaves = panelLeafPaths(PANEL);
    expect(leaves).toEqual([
      { path: "火系.等级", name: "等级", value: 3 },
      { path: "火系.熟练度", name: "熟练度" },
      { path: "火系.奥义.焚天", name: "焚天", value: "初成" },
      { path: "境界", name: "境界", value: "筑基三层" },
    ]);
    expect("value" in leaves[1]).toBe(false);
  });

  it("名字含 `.` 时逐字拼接（路径歧义的已知边界，行为固定于此）", () => {
    expect(panelLeafPaths([{ name: "a.b", children: [{ name: "c" }] }]).map((l) => l.path)).toEqual(["a.b.c"]);
    expect(panelLeafPaths([{ name: "a", children: [{ name: "b.c" }] }]).map((l) => l.path)).toEqual(["a.b.c"]);
  });

  it("无叶子（空面板 / 纯空分支）→ 空数组", () => {
    expect(panelLeafPaths([])).toEqual([]);
    expect(panelLeafPaths([{ name: "空分组" }])).toEqual([{ path: "空分组", name: "空分组" }]);
  });
});

describe("cloneAbilityPanel —— 模板派生快照", () => {
  it("深拷贝：改副本的嵌套数组/节点不影响源", () => {
    const source = structuredClone(PANEL);
    const copy = cloneAbilityPanel(source);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(copy[0]).not.toBe(source[0]);
    expect(copy[0].children).not.toBe(source[0].children);

    (copy[0].children as AbilityPanelNode[]).push({ name: "新增" });
    (copy[0].children as AbilityPanelNode[])[0].value = 99;
    copy[0].name = "改名";
    expect(source[0].name).toBe("火系");
    expect(source[0].children).toHaveLength(3);
    expect(source[0].children?.[0].value).toBe(3);
  });

  it("规范性：空 children 归一为叶子、分支上的 value 丢弃、叶子 value 保留（= 派生默认值）", () => {
    expect(cloneAbilityPanel([{ name: "等级", value: 7, children: [] }])).toEqual([{ name: "等级", value: 7 }]);
    expect(cloneAbilityPanel([{ name: "火系", value: 999, children: [{ name: "等级", value: 3 }] }])).toEqual([
      { name: "火系", children: [{ name: "等级", value: 3 }] },
    ]);
  });

  it("parse → clone 幂等（规范形状再派生不变）", () => {
    const once = parseAbilityPanel(PANEL);
    expect(cloneAbilityPanel(once)).toEqual(once);
  });
});

describe("coerceAbilityValue —— UI 输入 → 存储值", () => {
  it("纯数字字面量 → number（含负数/小数/首尾空白）", () => {
    expect(coerceAbilityValue("12")).toBe(12);
    expect(coerceAbilityValue(" 7 ")).toBe(7);
    expect(coerceAbilityValue("-3.5")).toBe(-3.5);
    expect(coerceAbilityValue("0")).toBe(0);
  });

  it("空串 / 纯空白 → undefined（空值）", () => {
    expect(coerceAbilityValue("")).toBeUndefined();
    expect(coerceAbilityValue("   ")).toBeUndefined();
  });

  it("非纯数字文本 → string（去首尾空白）", () => {
    expect(coerceAbilityValue("12级")).toBe("12级");
    expect(coerceAbilityValue(" 筑基三层 ")).toBe("筑基三层");
    expect(coerceAbilityValue("+5")).toBe("+5");
    expect(coerceAbilityValue("1,000")).toBe("1,000");
    expect(coerceAbilityValue("1e3")).toBe("1e3");
    expect(coerceAbilityValue("Infinity")).toBe("Infinity");
  });

  it("已知瑕疵：\"007\" 存为 7（丢前导零）；超双精度范围退回 string", () => {
    expect(coerceAbilityValue("007")).toBe(7);
    const huge = "9".repeat(400);
    expect(coerceAbilityValue(huge)).toBe(huge); // Number(huge) = Infinity → 不写入 Infinity
  });
});
