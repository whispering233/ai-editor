// 码字统计页 SSR 走查（`react-dom/server`，仓内无 jsdom）：页头常驻模板 + 标题/说明 + 加载骨架。
// 数据态（摘要 / 月历 / 趋势 / 热力）由子组件测试 + 纯函数测试覆盖；容器在 SSR 不跑 effect（无请求）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WritingStats from "./WritingStats";

function renderPage(): string {
  return renderToString(<WritingStats />).replace(/<!--[^>]*-->/g, "");
}

describe("码字统计页骨架", () => {
  it("页头常驻模板 + 标题「码字统计」+ 口径说明", () => {
    const html = renderPage();
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(html).toContain("码字统计");
    expect(html).toContain("按天累计新增正文字数 · 删除不扣减");
  });

  it("加载态 = 摘要 + 两块卡骨架（Skeleton），不渲染空图表", () => {
    const html = renderPage();
    expect(html).toContain("ant-skeleton");
    expect(html).toContain("码字日历");
    expect(html).toContain("码字趋势");
    expect(html).not.toContain("码字热力");
  });
});