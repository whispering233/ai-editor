// use-writing-rail 纯函数测试：默认值、localStorage 防御解析（坏 JSON / 非对象 / 数组 / width
// 缺失或非有限 → 整体回退默认）、宽度收敛、收起态仅严格 true。hook 本体依赖 window/localStorage
// （含拖拽/持久化副作用），node 环境不渲染（仓库无 jsdom，同 use-panels.test.ts 约定）。
import { describe, expect, it } from "vitest";
import {
  WRITING_RAIL_DEFAULT_WIDTH,
  WRITING_RAIL_MAX_WIDTH,
  WRITING_RAIL_MIN_WIDTH,
  defaultWritingRailLayout,
  parseWritingRailLayout,
} from "./use-writing-rail";

describe("defaultWritingRailLayout", () => {
  it("默认 240px、未收起", () => {
    expect(defaultWritingRailLayout()).toEqual({
      width: WRITING_RAIL_DEFAULT_WIDTH,
      collapsed: false,
    });
  });
});

describe("parseWritingRailLayout（防御解析）", () => {
  it("null / 空串 → 默认", () => {
    expect(parseWritingRailLayout(null)).toEqual(defaultWritingRailLayout());
    expect(parseWritingRailLayout("")).toEqual(defaultWritingRailLayout());
  });

  it("非法 JSON / 非对象 / 数组 → 整体回退默认", () => {
    expect(parseWritingRailLayout("not-json")).toEqual(defaultWritingRailLayout());
    expect(parseWritingRailLayout("[]")).toEqual(defaultWritingRailLayout());
    expect(parseWritingRailLayout("null")).toEqual(defaultWritingRailLayout());
    expect(parseWritingRailLayout('"240"')).toEqual(defaultWritingRailLayout());
    expect(parseWritingRailLayout("{}")).toEqual(defaultWritingRailLayout());
  });

  it("width 缺失 / 非数值 / 非有限 → 整体回退默认", () => {
    expect(parseWritingRailLayout('{"collapsed":true}')).toEqual(defaultWritingRailLayout());
    expect(parseWritingRailLayout('{"width":"240","collapsed":true}')).toEqual(
      defaultWritingRailLayout(),
    );
    // JSON 无法表达 NaN/Infinity，用溢出成 Infinity 的字面量验证非有限分支
    expect(parseWritingRailLayout('{"width":1e999}')).toEqual(defaultWritingRailLayout());
  });

  it("越界宽度收敛到 [200, 480]", () => {
    expect(parseWritingRailLayout('{"width":120}').width).toBe(WRITING_RAIL_MIN_WIDTH);
    expect(parseWritingRailLayout('{"width":9999}').width).toBe(WRITING_RAIL_MAX_WIDTH);
    expect(parseWritingRailLayout('{"width":200.6}').width).toBe(201);
    expect(parseWritingRailLayout('{"width":333}').width).toBe(333);
  });

  it("收起态仅严格 true 生效", () => {
    expect(parseWritingRailLayout('{"width":240,"collapsed":true}').collapsed).toBe(true);
    expect(parseWritingRailLayout('{"width":240,"collapsed":"yes"}').collapsed).toBe(false);
    expect(parseWritingRailLayout('{"width":240,"collapsed":1}').collapsed).toBe(false);
    expect(parseWritingRailLayout('{"width":240}').collapsed).toBe(false);
  });
});