// ui store 焦点状态测试（跨页「问 AI」入口的 currentFocus 数据源）
// 覆盖：setCurrentFocus 上报 / clearCurrentFocus 清空（路由切换语义）/ 初始为 null；
// 卡 13.4：focusMode 专注标志（瞬态，同样由路由切换归零）
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui";

beforeEach(() => {
  useUiStore.setState({ currentFocus: null, focusMode: false });
});

describe("ui store currentFocus", () => {
  it("初始为 null（无焦点语义）", () => {
    expect(useUiStore.getState().currentFocus).toBeNull();
  });

  it("setCurrentFocus 上报页面焦点（实体上下文）", () => {
    useUiStore.getState().setCurrentFocus({ focus_entity_type: "character", focus_entity_id: "char-1" });
    expect(useUiStore.getState().currentFocus).toEqual({ focus_entity_type: "character", focus_entity_id: "char-1" });
  });

  it("setCurrentFocus 支持大纲节点焦点（focus_node_id）", () => {
    useUiStore.getState().setCurrentFocus({ focus_node_id: "sc-42" });
    expect(useUiStore.getState().currentFocus).toEqual({ focus_node_id: "sc-42" });
  });

  it("clearCurrentFocus 清空（路由切换时 MainPanel useLayoutEffect 调用）", () => {
    useUiStore.getState().setCurrentFocus({ focus_entity_id: "loc-9", focus_entity_type: "location" });
    useUiStore.getState().clearCurrentFocus();
    expect(useUiStore.getState().currentFocus).toBeNull();
  });
});

describe("ui store focusMode（专注模式：瞬态标志，刷新即回常规布局）", () => {
  it("初始 false；setFocusMode 开 / 关", () => {
    expect(useUiStore.getState().focusMode).toBe(false);
    useUiStore.getState().setFocusMode(true);
    expect(useUiStore.getState().focusMode).toBe(true);
    // 路由守卫（MainPanel useLayoutEffect）用的就是这一个写入口
    useUiStore.getState().setFocusMode(false);
    expect(useUiStore.getState().focusMode).toBe(false);
  });
});
