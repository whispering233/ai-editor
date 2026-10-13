// 练习区占位页（`#/practice`，卡 8）渲染走查：仓内无 jsdom，用 react-dom/server 直渲染。
// 契约 = DESIGN.md §文风练习区：页头常驻模板（`section: flex h-full min-h-0 flex-col` + 内容进内层可滚容器）
// + 空态文案；本壳**不调任何练习业务端点**（`/practice/*` 归卡 9，该守卫在
// pages/dashboard-partitions.test.ts 里扫源码），故可 SSR 直渲。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Practice from "./Practice";

const html = renderToString(<Practice />);

describe("练习区占位页（#/practice）", () => {
  it("页头常驻模板：h-full min-h-0 flex flex-col + 内容进内层可滚容器", () => {
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  it("页头文案 = 文风练习（左栏导航项同名）", () => {
    expect(html).toContain("文风练习");
  });

  it("空态给一行文案（不是空白块，也不放还没有能力的按钮）", () => {
    expect(html).toContain("还没有练习目标");
    expect(html).toContain("border-dashed"); // empty-state 虚线卡
  });
});
