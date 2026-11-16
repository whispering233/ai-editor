// use-outline-rail 纯函数测试（同 use-writing-rail.test.ts 约定）：默认值、localStorage 防御解析
// （坏 JSON / 非对象 / 数组 / width 缺失或非有限 → 只丢宽度保留收起态）、宽度收敛、收起态仅严格 true。
// hook 本体依赖 window/localStorage + 拖拽副作用，node 环境不渲染（仓库无 jsdom）。
import { describe, expect, it } from "vitest";
import {
  OUTLINE_RAIL_MAX_WIDTH,
  OUTLINE_RAIL_MIN_WIDTH,
  defaultOutlineRailLayout,
  parseOutlineRailLayout,
} from "./use-outline-rail";

describe("defaultOutlineRailLayout", () => {
  it("默认不写像素宽度（用 max(320px, 中栏 1/3) 的 CSS 值）、未收起", () => {
    expect(defaultOutlineRailLayout()).toEqual({ width: null, collapsed: false });
  });
});

describe("parseOutlineRailLayout（防御解析）", () => {
  it("null / 空串 → 默认", () => {
    expect(parseOutlineRailLayout(null)).toEqual(defaultOutlineRailLayout());
    expect(parseOutlineRailLayout("")).toEqual(defaultOutlineRailLayout());
  });

  it("非法 JSON / 非对象 / 数组 → 整体回退默认", () => {
    expect(parseOutlineRailLayout("not-json")).toEqual(defaultOutlineRailLayout());
    expect(parseOutlineRailLayout("[]")).toEqual(defaultOutlineRailLayout());
    expect(parseOutlineRailLayout("null")).toEqual(defaultOutlineRailLayout());
    expect(parseOutlineRailLayout('"333"')).toEqual(defaultOutlineRailLayout());
    expect(parseOutlineRailLayout("{}")).toEqual(defaultOutlineRailLayout());
  });

  it("width 缺失 / 非数值 / 非有限 → 只回到默认宽度，收起态照旧生效", () => {
    expect(parseOutlineRailLayout('{"collapsed":true}')).toEqual({
      width: null,
      collapsed: true,
    });
    expect(parseOutlineRailLayout('{"width":"333","collapsed":true}')).toEqual({
      width: null,
      collapsed: true,
    });
    // JSON 无法表达 NaN/Infinity，用溢出成 Infinity 的字面量验证非有限分支
    expect(parseOutlineRailLayout('{"width":1e999}')).toEqual({ width: null, collapsed: false });
  });

  it("越界宽度收敛到 [280, 600]、小数取整", () => {
    expect(parseOutlineRailLayout('{"width":120}').width).toBe(OUTLINE_RAIL_MIN_WIDTH);
    expect(parseOutlineRailLayout('{"width":9999}').width).toBe(OUTLINE_RAIL_MAX_WIDTH);
    expect(parseOutlineRailLayout('{"width":280.6}').width).toBe(281);
    expect(parseOutlineRailLayout('{"width":333}').width).toBe(333);
  });

  it("收起态仅严格 true 生效", () => {
    expect(parseOutlineRailLayout('{"width":333,"collapsed":true}').collapsed).toBe(true);
    expect(parseOutlineRailLayout('{"width":333,"collapsed":"yes"}').collapsed).toBe(false);
    expect(parseOutlineRailLayout('{"width":333,"collapsed":1}').collapsed).toBe(false);
    expect(parseOutlineRailLayout('{"width":333}').collapsed).toBe(false);
  });
});
