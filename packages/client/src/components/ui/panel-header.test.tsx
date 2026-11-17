// 工作台子栏页头 SSR 走查（仓内无 jsdom，同 pages/writing.test.tsx 惯例）。
// 契约 = docs/ui/DESIGN.md §Layout「工作台子栏页头」：标题行 40 + 元信息行 24（恒渲染）+ 1px 分割线
// ⇒ 分割线恒落在内容顶下方 64px；标题 16px / 600 单行截断不换行；leading / actions 同处标题行。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PanelHeader } from "./panel-header";

function render(ui: React.ReactElement): string {
  return renderToString(ui).replace(/<!--[^>]*-->/g, "");
}

describe("PanelHeader · 几何（标题行 40 + 元信息行 24 + 分割线）", () => {
  it("标题行固定 40px，标题 = 16px / 600 单行截断（不换行、不是 PageTitle 的 20px）", () => {
    const html = render(<PanelHeader title="卷章" />);
    expect(html).toContain("flex h-10 min-w-0 items-center gap-2");
    expect(html).toContain("truncate text-base font-semibold");
    expect(html).toContain(">卷章<");
    expect(html).not.toContain("flex-wrap");
    expect(html).not.toContain("ant-typography"); // 不用 PageTitle（20px antd 标题档）
  });

  it("元信息行恒渲染 24px（不传 meta 也留白）；带内容时原样放入同一行", () => {
    const empty = render(<PanelHeader title="卷章" />);
    expect(empty).toContain('<div class="flex h-6 min-w-0 items-center gap-2"></div>');

    const withMeta = render(<PanelHeader title="写作" meta={<span>1.2 千字</span>} />);
    expect(withMeta).toContain("flex h-6 min-w-0 items-center gap-2");
    expect(withMeta).toContain("<span>1.2 千字</span>");
  });

  it("分割线紧跟元信息行 = T+64；组件自带 mb-4 / shrink-0", () => {
    const html = render(<PanelHeader title="写作" />);
    expect(html).toContain("mb-4 flex shrink-0 flex-col");
    expect(html).toContain("h-px w-full shrink-0 bg-border");
    // 顺序：标题行 → 元信息行 → 分割线（中间无 mt-* / 额外留白）
    expect(html.indexOf("h-10")).toBeLessThan(html.indexOf("h-6"));
    expect(html.indexOf("h-6")).toBeLessThan(html.indexOf("h-px"));
  });
});

describe("PanelHeader · leading / actions / className", () => {
  it("leading 在标题左、actions 在标题右，都留在 40px 标题行内", () => {
    const html = render(
      <PanelHeader
        title="写作"
        leading={<button type="button">收起</button>}
        actions={<button type="button">上一章</button>}
      />,
    );
    expect(html.indexOf("收起")).toBeLessThan(html.indexOf(">写作<"));
    expect(html.indexOf(">写作<")).toBeLessThan(html.indexOf("上一章"));
    expect(html.indexOf("h-10")).toBeLessThan(html.indexOf("上一章"));
    expect(html.indexOf("h-6")).toBeGreaterThan(html.indexOf("上一章"));
  });

  it("className 合并：详情列 `-mx-6 px-6` 穿透内边距；rail 用 `mb-0` 让行区紧随分割线", () => {
    const detail = render(<PanelHeader title="正文" className="-mx-6 px-6" />);
    expect(detail).toContain("mb-4 flex shrink-0 flex-col -mx-6 px-6");

    const rail = render(<PanelHeader title="卷章" className="mb-0 px-3" />);
    expect(rail).toContain("mb-0 px-3");
    expect(rail).not.toContain("mb-4"); // twMerge：同属性后者胜
  });
});
