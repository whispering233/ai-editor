// use-setting-rail 纯函数测试（同 use-outline-rail.test.ts 约定）：默认值、localStorage 防御解析
// （坏 JSON / 非对象 / 数组）、width 缺失或非有限 → 只丢宽度保留两档收起态、宽度收敛到 [280, 720]、
// 两档收起态仅严格 true。hook 本体依赖 window/localStorage + 拖拽副作用，node 环境不渲染（仓库无 jsdom）。
import { describe, expect, it } from "vitest";
import {
  SETTING_RAIL_KEY,
  SETTING_RAIL_MAX,
  SETTING_RAIL_MIN,
  defaultSettingRailLayout,
  parseSettingRailLayout,
} from "./use-setting-rail";

describe("setting rail 常量", () => {
  it("localStorage key 与拖拽区间为契约值", () => {
    expect(SETTING_RAIL_KEY).toBe("ai-editor:setting-rail");
    expect(SETTING_RAIL_MIN).toBe(280);
    expect(SETTING_RAIL_MAX).toBe(720);
  });
});

describe("defaultSettingRailLayout", () => {
  it("默认不写像素宽度（用 CSS 的 max(320px, 中栏 1/2)）、两档都展开", () => {
    expect(defaultSettingRailLayout()).toEqual({
      width: null,
      collapsed: false,
      detailCollapsed: false,
    });
  });
});

describe("parseSettingRailLayout（防御解析）", () => {
  it("null / 空串 → 默认", () => {
    expect(parseSettingRailLayout(null)).toEqual(defaultSettingRailLayout());
    expect(parseSettingRailLayout("")).toEqual(defaultSettingRailLayout());
  });

  it("坏 JSON → 整体回退默认", () => {
    expect(parseSettingRailLayout("not-json")).toEqual(defaultSettingRailLayout());
    expect(parseSettingRailLayout("{")).toEqual(defaultSettingRailLayout());
  });

  it("非对象 / 数组 → 整体回退默认", () => {
    expect(parseSettingRailLayout("[]")).toEqual(defaultSettingRailLayout());
    expect(parseSettingRailLayout("null")).toEqual(defaultSettingRailLayout());
    expect(parseSettingRailLayout("42")).toEqual(defaultSettingRailLayout());
    expect(parseSettingRailLayout("true")).toEqual(defaultSettingRailLayout());
    expect(parseSettingRailLayout('"333"')).toEqual(defaultSettingRailLayout());
  });

  it("width 缺失 / 非数值 / 非有限 → 只回到默认宽度，两档收起态照旧生效", () => {
    expect(parseSettingRailLayout('{"collapsed":true,"detailCollapsed":true}')).toEqual({
      width: null,
      collapsed: true,
      detailCollapsed: true,
    });
    expect(parseSettingRailLayout('{"width":"333","collapsed":true}')).toEqual({
      width: null,
      collapsed: true,
      detailCollapsed: false,
    });
    expect(parseSettingRailLayout('{"width":null}')).toEqual(defaultSettingRailLayout());
    // JSON 无法表达 NaN/Infinity，用溢出成 Infinity 的字面量验证非有限分支
    expect(parseSettingRailLayout('{"width":1e999}')).toEqual(defaultSettingRailLayout());
  });

  it("越界宽度收敛到 [280, 720]、小数取整", () => {
    expect(parseSettingRailLayout('{"width":120}').width).toBe(SETTING_RAIL_MIN);
    expect(parseSettingRailLayout('{"width":9999}').width).toBe(SETTING_RAIL_MAX);
    expect(parseSettingRailLayout('{"width":280.6}').width).toBe(281);
    expect(parseSettingRailLayout('{"width":333}').width).toBe(333);
  });

  it("两档收起态仅严格 true 生效", () => {
    expect(
      parseSettingRailLayout('{"collapsed":true,"detailCollapsed":true}'),
    ).toMatchObject({ collapsed: true, detailCollapsed: true });
    expect(
      parseSettingRailLayout('{"collapsed":"yes","detailCollapsed":"yes"}'),
    ).toMatchObject({ collapsed: false, detailCollapsed: false });
    expect(
      parseSettingRailLayout('{"collapsed":1,"detailCollapsed":0}'),
    ).toMatchObject({ collapsed: false, detailCollapsed: false });
    expect(parseSettingRailLayout('{"width":333}')).toMatchObject({
      collapsed: false,
      detailCollapsed: false,
    });
  });
});
