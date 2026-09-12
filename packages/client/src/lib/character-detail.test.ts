// 人物详情双视图判据单测（卡 3.2）：默认 tab / 计算节点默认值 / 只读取值展示。
// 契约：docs/ui/DESIGN.md `character-workbench`（有当前位置 → tab 2；未设置 → tab 1 + 提示）；
// docs/design/10-data-model.md §14 不变式 2/3（不可变字段不参与 Delta ⇒ 两视图一致；tab 2 只读）。
import { describe, expect, it } from "vitest";
import {
  readOnlyFieldValue,
  resolveCurrentAtNode,
  resolveDefaultTab,
} from "./character-detail";

describe("resolveDefaultTab", () => {
  it("设置了当前位置 → 「当前位置数据」", () => {
    expect(resolveDefaultTab("ch-1")).toBe("current");
  });

  it("未设置（null/undefined/空串/纯空白）→ 「初始化数据」", () => {
    expect(resolveDefaultTab(null)).toBe("initial");
    expect(resolveDefaultTab(undefined)).toBe("initial");
    expect(resolveDefaultTab("")).toBe("initial");
    expect(resolveDefaultTab("   ")).toBe("initial");
  });
});

describe("resolveCurrentAtNode", () => {
  it("当前位置存在于大纲树 → 作为计算节点", () => {
    expect(resolveCurrentAtNode("ch-2", ["ch-1", "ch-2"])).toBe("ch-2");
  });

  it("失效/软删/未设置 → 空串（要求手动选择，不做无效计算）", () => {
    expect(resolveCurrentAtNode("ch-9", ["ch-1", "ch-2"])).toBe("");
    expect(resolveCurrentAtNode(null, ["ch-1"])).toBe("");
    expect(resolveCurrentAtNode("", ["ch-1"])).toBe("");
  });
});

describe("readOnlyFieldValue", () => {
  it("undefined/null → 空串；标量 String 化", () => {
    expect(readOnlyFieldValue(undefined)).toBe("");
    expect(readOnlyFieldValue(null)).toBe("");
    expect(readOnlyFieldValue(3)).toBe("3");
    expect(readOnlyFieldValue("主角")).toBe("主角");
  });

  it("数组 → 「、」连接（与列表摘要同款展示口径）", () => {
    expect(readOnlyFieldValue(["坚韧", "多疑"])).toBe("坚韧、多疑");
    expect(readOnlyFieldValue([])).toBe("");
  });
});
