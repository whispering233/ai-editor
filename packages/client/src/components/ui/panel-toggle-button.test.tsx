// `PanelToggleButton` SSR 走查（仓内无 jsdom/@testing-library，用 react-dom/server，同 MainToolbar.test）。
// 契约 = docs/ui/DESIGN.md §Components `icon-button` / `panel-toggle-icon`：普通 icon-button 表皮
// （不是圆钮）+ 静态面板图形；状态只由动态 `aria-label` / `title` / `aria-expanded` 表达，图标不换向。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PanelToggleButton } from "./panel-toggle-button";

function render({
  side = "left",
  collapsed = false,
  label = "大纲树",
}: {
  side?: "left" | "right";
  collapsed?: boolean;
  label?: string;
} = {}): string {
  return renderToString(
    <PanelToggleButton side={side} collapsed={collapsed} label={label} onToggle={() => {}} />,
  );
}

describe("PanelToggleButton · 面板图形", () => {
  it("`side=\"left\"` 竖线靠左、`side=\"right\"` 靠右（同一枚 24 viewBox 圆角矩形）", () => {
    const left = render({ side: "left" });
    expect(left).toContain('d="M9 4 V20"');
    expect(left).not.toContain('d="M15 4 V20"');
    expect(left).toContain('viewBox="0 0 24 24"');
    expect(left).toContain("<rect ");

    const right = render({ side: "right" });
    expect(right).toContain('d="M15 4 V20"');
    expect(right).not.toContain('d="M9 4 V20"');
    expect(right).toContain('viewBox="0 0 24 24"');
  });

  it("普通 icon-button 表皮：不是圆钮，也不用图标字体（`anticon` / 双箭头都不在）", () => {
    const html = render();
    expect(html).toContain("ant-btn");
    expect(html).not.toContain("ant-btn-circle");
    expect(html).not.toContain("anticon");
    expect(html).not.toContain("ant-btn-primary");
  });
});

describe("PanelToggleButton · 状态只走 aria / title", () => {
  it("展开态：`收起<label>` + `aria-expanded=\"true\"`", () => {
    const html = render({ label: "卷章导航栏" });
    expect(html).toContain('aria-label="收起卷章导航栏"');
    expect(html).toContain('title="收起卷章导航栏"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain("展开卷章导航栏");
  });

  it("收起态：`展开<label>` + `aria-expanded=\"false\"`，图标仍是同一枚（不换向）", () => {
    const html = render({ side: "right", collapsed: true, label: "右侧详情" });
    expect(html).toContain('aria-label="展开右侧详情"');
    expect(html).toContain('title="展开右侧详情"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("收起右侧详情");
    expect(html).toContain('d="M15 4 V20"');
  });
});
