// ui store 焦点状态测试（决策 35，批次九：InfoBar「问 AI」入口的 currentFocus 数据源）
// 覆盖：setCurrentFocus 上报 / clearCurrentFocus 清空（路由切换语义）/ 初始为 null
import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui";

beforeEach(() => {
  useUiStore.setState({ currentFocus: null });
});

describe("ui store currentFocus（决策 35）", () => {
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
