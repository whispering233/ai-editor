// `ShellPanelToggles` SSR 走查（仓内无 jsdom/@testing-library，用 react-dom/server，同 MainToolbar.test）。
// 契约 = docs/ui/DESIGN.md §Layout「三栏」子条「整栏开关锚定视口顶带两角」/ §Components `panel-toggle-icon`：
// 两枚 `PanelToggleButton` 绝对定位于应用根两角（`left-4` / `right-4` + `top-3`），坐标只由视口决定；
// 图标静态不换向，状态只由动态 `aria-label` / `title` / `aria-expanded` 表达。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShellPanelToggles } from "./shell-panel-toggles";

function render({
  sidebarCollapsed = false,
  chatCollapsed = false,
}: {
  sidebarCollapsed?: boolean;
  chatCollapsed?: boolean;
} = {}): string {
  return renderToString(
    <ShellPanelToggles
      sidebarCollapsed={sidebarCollapsed}
      chatCollapsed={chatCollapsed}
      onToggleSidebar={() => {}}
      onToggleChat={() => {}}
    />,
  );
}

describe("ShellPanelToggles · 顶带两角", () => {
  it("两个绝对定位包装：左角 `left-4`、右角 `right-4`，同为 `top-3`", () => {
    const out = render();
    expect(out).toContain("absolute left-4 top-3");
    expect(out).toContain("absolute right-4 top-3");
    expect(out.match(/class="absolute /g)).toHaveLength(2);
  });

  it("两枚按钮，文案「左栏」/「右栏」，右角在左角之后", () => {
    const out = render();
    expect(out.match(/<button/g)).toHaveLength(2);
    expect(out.indexOf('aria-label="收起左栏"')).toBeGreaterThanOrEqual(0);
    expect(out.indexOf('aria-label="收起右栏"')).toBeGreaterThan(
      out.indexOf('aria-label="收起左栏"'),
    );
  });

  it("左钮竖线靠左、右钮竖线靠右（同一枚 24 viewBox 面板图形）", () => {
    const out = render();
    expect(out.match(/viewBox="0 0 24 24"/g)).toHaveLength(2);
    expect(out.match(/<rect /g)).toHaveLength(2);
    expect(out).toContain('d="M9 4 V20"');
    expect(out).toContain('d="M15 4 V20"');
  });

  it("展开态：`收起左栏` + `aria-expanded=\"true\"`（图标不换向）", () => {
    const out = render();
    expect(out).toContain('title="收起左栏"');
    expect(out).toContain('title="收起右栏"');
    expect(out.match(/aria-expanded="true"/g)).toHaveLength(2);
    expect(out).not.toContain('aria-expanded="false"');
  });

  it("收起态：文案与 `aria-expanded` 翻转", () => {
    const out = render({ sidebarCollapsed: true, chatCollapsed: true });
    expect(out).toContain('aria-label="展开左栏"');
    expect(out).toContain('aria-label="展开右栏"');
    expect(out).not.toContain("收起左栏");
    expect(out).not.toContain("收起右栏");
    expect(out.match(/aria-expanded="false"/g)).toHaveLength(2);
  });

  it("普通 icon-button 表皮：不是圆钮、不加选中面", () => {
    const out = render();
    expect(out).toContain("ant-btn");
    expect(out).not.toContain("ant-btn-circle");
    expect(out).not.toContain("ant-btn-primary");
  });
});
