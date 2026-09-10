// EmptyState 走查（批次十九 T4）：内部换 antd Empty 后的 SSR 静态断言。
// 重点锁 `Empty` 的 image 假值行为：antd v6 用 `image ?? contextImage ?? 默认插图` 合并，
// 传 null 会被当作缺省而回落默认插图（100px 占位），故必须传 false——本用例是这条不变式的护栏。
// 渲染手法同 antd-smoke.test / chat-panel.test（仓库无 jsdom/@testing-library 纪律，用 renderToString）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { EmptyState } from "./empty-state";

describe("EmptyState（内部 antd Empty）", () => {
  it("虚线卡 + 灰字说明，且不渲染 antd 插图", () => {
    const html = renderToString(<EmptyState>还没有书，先创建一本</EmptyState>);
    expect(html).toContain("还没有书，先创建一本");
    expect(html).toContain("rounded-lg border border-dashed");
    expect(html).toContain("ant-empty-image");
    expect(html).toMatch(/ant-empty-image[^"]*hidden/); // 100px 插图占位容器一并隐藏
    expect(html).not.toContain("<svg"); // 传 null 会回落默认插图 → 此断言即防回归
  });

  it("padding 档位与 action 透传", () => {
    const html = renderToString(
      <EmptyState padding="sm" action={<button type="button">新建</button>}>
        空
      </EmptyState>,
    );
    expect(html).toContain("py-10");
    expect(html).toContain("新建");
  });
});
