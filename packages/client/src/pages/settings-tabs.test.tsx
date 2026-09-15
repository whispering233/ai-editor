// 设置页二级 tab 的形态守卫：桌面版多一个「通用」（书库位置），浏览器形态**完全没有该 tab**。
// 为什么用 SSR 断言：`Tabs` 的 label 会渲染在 tab 条上，这正是「有没有这个入口」的判据；
// 真实浏览器另有一遍人工核（见 tasks.md 的待人工验证清单）。
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import Settings from "./Settings";

/** 受控替换全局 window（node 环境下默认没有 window；每例后恢复） */
function setWindow(value: unknown): void {
  (globalThis as unknown as { window?: unknown }).window = value;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

const BRIDGE = {
  ready: true,
  pickDirectory: async () => null,
  getLibraryRoot: async () => "/books",
  changeLibraryRoot: async () => null,
};

describe("设置页二级 tab", () => {
  it("浏览器形态（无桥）：无「通用」，顺序 = AI 模型 → 项目规则 → 备份", () => {
    const html = renderToString(<Settings />);
    expect(html).not.toContain("通用");
    const order = ["AI 模型", "项目规则", "备份"].map((label) => html.indexOf(label));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("桌面版（有桥）：「通用」排在首位", () => {
    setWindow({ aiEditorDesktop: BRIDGE });
    const html = renderToString(<Settings />);
    expect(html).toContain("通用");
    expect(html.indexOf("通用")).toBeLessThan(html.indexOf("AI 模型"));
  });
});
