// focusNewItem 契约测试（A2）：命中 → 滚动 + 聚焦 + true；未命中 → false 且不抛。
// client 测试环境为 node（无 jsdom）——用 vi.stubGlobal 打桩 document，只锁 DOM 动作契约。
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusNewItem } from "./new-item-focus";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("focusNewItem", () => {
  it("命中：滚动到视口中部 + 聚焦 + 返回 true", () => {
    const el = { focus: vi.fn(), scrollIntoView: vi.fn() };
    vi.stubGlobal("document", { querySelector: () => el });

    expect(focusNewItem('[data-x="1"]')).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(el.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("未命中：返回 false（调用方静默忽略）", () => {
    vi.stubGlobal("document", { querySelector: () => null });

    expect(focusNewItem('[data-x="1"]')).toBe(false);
  });
});
