// SectionCard 走查（T4）：内部换 antd Card 后的 SSR 静态断言——1px 描边卡 + level={5} 标题，
// 不再手写 `rounded-xl border bg-card p-4` / `font-serif` 标题。
// 渲染手法同 antd-smoke.test / chat-panel.test（仓库无 jsdom/@testing-library 纪律，用 renderToString）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SectionCard } from "./section-card";

describe("SectionCard（内部 antd Card）", () => {
  it("antd Card + Typography.Title level={5}，无手写衬线标题", () => {
    const html = renderToString(
      <SectionCard title="项目信息" action={<button type="button">编辑</button>}>
        内容
      </SectionCard>,
    );
    expect(html).toContain("ant-card");
    expect(html).toContain("ant-typography");
    expect(html).toContain("<h5");
    expect(html).not.toContain("font-serif");
    expect(html).toContain("编辑");
    expect(html).toContain("内容");
  });

  it("缺省标题不渲染标题行", () => {
    const html = renderToString(<SectionCard>无标题区块</SectionCard>);
    expect(html).not.toContain("<h5");
    expect(html).toContain("无标题区块");
  });
});
